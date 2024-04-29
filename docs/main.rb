require "js"

# Hack to ignore "require 'io/console'" and "require 'io/wait'"
Dir.mkdir("/tmp")
Dir.mkdir("/tmp/io")
File.write("/tmp/io/console.rb", "")
File.write("/tmp/io/wait.rb", "")
$LOAD_PATH.unshift("/tmp")
module Kernel
  alias_method :require, :gem_original_require
end

# io shim
class IO
  alias getbyte_orig getbyte
  def getbyte
    if to_i == 0
      c = JSFuncs[:getByte].apply().await
      return c == JS::Null ? nil : c.to_i
    end
    getbyte_orig
  end

  alias getc_orig getc
  def getc
    return getbyte&.chr if to_i == 0
    getc_orig
  end

  alias read_nonblock_orig read_nonblock
  def read_nonblock(size, outbuf = nil, exception: true)
    if to_i == 0
      s = JSFuncs[:readNonblock].apply(size).await
      return nil if s == JS::Null
      s = s.to_s
      s = outbuf.replace(s) if outbuf
      return s
    end
    read_nonblock_orig(size, outbuf, exception:)
  end
end

# io/console shim
class IO
  def winsize
    JSFuncs[:winsize].apply().to_a.map {|n| n.to_i }.reverse
  end

  def raw(min: 1, time: 0, intr: false)
    raise NotImplementedError if time != 0
    begin
      old_termios = JSFuncs[:setRaw].apply(min, intr)
      yield self
    ensure
      JSFuncs[:setTermios].apply(old_termios)
    end
  end

  def cooked(min: 1, time: 0, intr: false)
    raise NotImplementedError if time != 0
    begin
      old_termios = JSFuncs[:setCooked].apply()
      yield self
    ensure
      JSFuncs[:setTermios].apply(old_termios)
    end
  end

  def tty?
    case to_i
    when 0, 1, 2; true
    else false
    end
  end
end

# io/wait shim
class IO
  def wait_readable(timeout)
    JSFuncs[:waitReadable].apply(timeout).await != JS::False ? self : nil
  end
end

# Kernel#sleep shim
module Kernel
  def sleep(duration = nil)
    JSFuncs[:sleep].apply(duration).await
    nil
  end
end

ENV["HOME"] = "/" # Hack to pass `File.expand_path("~/")`
ENV["TERM"] = "xterm-256color"

require "irb"

# Hack to avoid `IO.open(1, "w")`
module IRB
  class StdioInputMethod < InputMethod
    def initialize
      @line_no = 0
      @line = []
      @stdin = IO.open(STDIN.to_i, :external_encoding => IRB.conf[:LC_MESSAGES].encoding, :internal_encoding => "-")
      # original: @stdout = IO.open(STDOUT.to_i, 'w', :external_encoding => IRB.conf[:LC_MESSAGES].encoding, :internal_encoding => "-")
      @stdout = STDOUT
    end
  end
end

# Run irb
GC.disable # Hack to avoid "RuntimeError: null function or function signature mismatch"
IRB.setup(nil, argv: ['--no-pager'])
IRB::Irb.new.run
