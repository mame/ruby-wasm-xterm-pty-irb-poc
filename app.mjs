import { RubyVM, consolePrinter } from "./node_modules/@ruby/wasm-wasi/dist/esm";
import { WASI, File, OpenFile, PreopenDirectory } from "./node_modules/@bjorn3/browser_wasi_shim/dist";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openpty } from "xterm-pty";

const setupTerminal = () => {
  const div = document.getElementById("terminal");

  const xterm = new Terminal();
  xterm.open(div);
  
  const { master, slave } = openpty();
  xterm.loadAddon(master);
  
  const fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);
  new ResizeObserver(() => fitAddon.fit()).observe(div);
  fitAddon.fit();
  
  xterm.loadAddon(new WebLinksAddon());

  return slave;
}

const fetchRubyWasm = async (onProgress) => {
  const response = await fetch("ruby+stdlib.wasm");
  const reader = response.body.getReader();
  let loaded = 0;
  const chunks = [];
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    loaded += chunk.byteLength;
    onProgress(loaded);
    chunks.push(chunk);
  }
  const image = new Uint8Array(loaded);
  for (let i = 0, off = 0; i < chunks.length; i++) {
    image.set(chunks[i], off);
    off += chunks[i].byteLength;
  }
  return image;
};

const setupRubyWasm = async (image, out) => {
  const module = await WebAssembly.compile(image);
  const fds = [
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new OpenFile(new File([])),
    new PreopenDirectory("/", []),
  ];
  const wasi = new WASI([], [], fds, { debug: false });
  const vm = new RubyVM();

  const imports = {
    wasi_snapshot_preview1: wasi.wasiImport,
  };
  vm.addToImports(imports);

  const printer = consolePrinter({ stdout: out, stderr: out });
  printer.addToImports(imports);
  const instance = await WebAssembly.instantiate(module, imports);
  await vm.setInstance(instance);

  printer.setMemory(instance.exports.memory);

  wasi.initialize(instance);
  vm.initialize();

  return vm;
}

const main = async () => {
  const slave = setupTerminal();

  const waitTimeout = (timeout) => new Promise((resolve) => {
    setTimeout(() => resolve(false), timeout * 1000)
  });
  const waitReadable = () => new Promise((resolve) => {
    const handle = slave.onReadable(() => {
      handle.dispose();
      resolve();
    });
  });

  const image = await fetchRubyWasm((loaded) => slave.write(`Loading Ruby Wasm: ${loaded}\r`));
  const vm = await setupRubyWasm(image, (data) => slave.write(data));

  vm.eval("-> js_funcs { JSFuncs = js_funcs }").call("call", vm.wrap({
    winsize: () => slave.ioctl("TIOCGWINSZ"),
    setRaw: (min, intr) => {
      const oldTermios = slave.ioctl("TCGETS");
      const newTermios = JSON.parse(JSON.stringify(oldTermios));
      newTermios.lflag &= ~0x807b; // ECHO|ECHOE|ECHOK|ECHONL|ICANON|ISIG|IEXTEN
      newTermios.iflag &= ~0x2de0; // ISTRIP|INLCR|IGNCR|ICRNL|IXON|IXOFF|IXANY|IMAXBEL
      newTermios.oflag &= ~0x0001; // OPOST
      newTermios.cc[6] = min; // VMIN
      if (intr) {
        newTermios.lflag |= 0x0001; // ISIG
        newTermios.oflag |= 0x0001; // OPOST
      }
      slave.ioctl("TCSETS", newTermios);
      return oldTermios;
    },
    setCooked: () => {
      const oldTermios = slave.ioctl("TCGETS");
      const newTermios = JSON.parse(JSON.stringify(oldTermios));
      newTermios.iflag |= 0x0520; // ISTRIP|ICRNL|IXON
      newTermios.oflag |= 0x0001; // OPOST
      newTermios.lflag |= 0x807b; // ECHO|ECHOE|ECHOK|ECHONL|ICANON|ISIG|IEXTEN
      slave.ioctl("TCSETS", newTermios);
      return oldTermios;
    },
    setTermios: (termios) => {
      slave.ioctl("TCSETS", termios);
    },
    waitReadable: async (timeout) => {
      if (slave.readable) return true;
      if (timeout == 0) return false;
      return await Promise.race([waitTimeout(timeout), waitReadable()]);
    },
    getByte: async () => {
      if (slave.readable) return slave.read(1)[0];

      const termios = slave.ioctl("TCGETS");
      const min = termios.cc[6]; // VMIN
      if (!min) return null;

      await waitReadable();

      if (slave.readable) return slave.read(1)[0];
      return null;
    },
    readNonblock: async (size) => {
      if (slave.readable) return slave.read(size);
      return null;
    },
    sleep: async (duration) => {
      await waitTimeout(duration);
    },
  }));

  slave.onSignal((signal) => vm.eval(`Process.kill(:${signal}, $$)`));

  const code = await fetch("main.rb");
  vm.evalAsync(await code.text());
};

main();