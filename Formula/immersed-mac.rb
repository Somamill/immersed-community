class ImmersedMac < Formula
  desc "Japanese video immersion, Netflix subtitles and local audiobooks for macOS"
  homepage "https://github.com/Somamill/immersed-community"
  url "https://github.com/Somamill/immersed-community/releases/download/v0.22.14/immersed-mac-0.22.14.tar.gz"
  sha256 "c0557304f972e1c8d8e2471766e819733e7a13e4ec4ef07c80573a88db94bb9d"
  head "https://github.com/Somamill/immersed-community.git", branch: "main"
  depends_on :macos
  depends_on "node"
  depends_on "python@3.13"
  depends_on "ffmpeg"
  depends_on "yt-dlp"

  def install
    libexec.install Dir["*"]
    (bin/"immersed-mac").write <<~EOS
      #!/bin/sh
      export IMMERSED_INSTALL_CHANNEL=brew
      export IMMERSED_BUNDLE_RUNTIME=1
      export PATH="#{Formula["python@3.13"].opt_bin}:#{HOMEBREW_PREFIX}/bin:$PATH"
      exec /bin/sh "#{libexec}/desktop/launch.sh" "#{libexec}" "$@"
    EOS
  end

  def caveats
    <<~EOS
      Start Immersed with: immersed-mac
      The first launch also installs immersed.app in ~/Applications so it
      can be opened from Finder, Spotlight, or Launchpad.
      Dictionary and speech resources are prepared when needed. A video must
      allow playback and local audio access for transcription to work.
    EOS
  end
end
