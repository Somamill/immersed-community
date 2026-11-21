@MainActor final class FocusProbe: NSObject, WKNavigationDelegate {
 let delegate = AppDelegate()
 func start() {
  delegate.web=WKWebView(frame:NSRect(x:0,y:0,width:1320,height:860))
  delegate.window=NSWindow(contentRect:delegate.web.frame,styleMask:[.titled,.resizable,.fullSizeContentView],backing:.buffered,defer:false)
  let surface=NSView(frame:delegate.web.frame);surface.addSubview(delegate.web);delegate.window.contentView=surface
  delegate.showStartupAnimation();surface.layoutSubtreeIfNeeded()
  precondition(delegate.loading.superview===surface,"Startup must sit above WebKit, not inside it")
  let artwork = delegate.loading.subviews.compactMap { $0 as? StartupArtworkView }.first
  precondition(delegate.loading.bounds.width > 0 && artwork?.bounds.size == NSSize(width: 180, height: 160),
               "Startup must display a centered, sized artwork view")
  precondition(artwork?.layer?.sublayers?.contains { $0 is CAShapeLayer } == true,
               "Startup artwork must render even when the packaged icon is unavailable")
  delegate.loading.removeFromSuperview()
  delegate.web.navigationDelegate=self
  delegate.web.loadHTMLString("<script>window.calls=[];window.immersedPlayback=(a,v)=>calls.push([a,v??null]);</script>",baseURL:URL(string:"http://localhost:4799"))
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
  delegate.netflixView=WKWebView(frame:delegate.web.frame)
  delegate.enterNetflixFullscreen()
  let focus=delegate.netflixFocus!
  for size in [NSSize(width:800,height:600),NSSize(width:1320,height:860),NSSize(width:1850,height:1000)] {
   delegate.window.setContentSize(size);focus.layoutSubtreeIfNeeded()
   focus.expanded=true;focus.layoutSubtreeIfNeeded()
   precondition(delegate.web.frame.minX>=0 && delegate.web.frame.maxX<=focus.bounds.width)
  }
  precondition(focus.subviews.compactMap{$0 as? NSButton}.count==1,"Only the exit button belongs above Netflix")
  precondition(!focus.subviews.contains{$0 is NSStackView},"No duplicate playback buttons in fullscreen")
  delegate.web.evaluateJavaScript("JSON.stringify(window.calls)") { value,error in
   precondition(error==nil && (value as? String)=="[]","Entering fullscreen must not issue playback commands")
   print("PASS native startup overlay and minimal Netflix fullscreen at three sizes")
   exit(0)
  }
 }
}
@main struct Main {
 @MainActor static func main() {
  let app=NSApplication.shared;let probe=FocusProbe();probe.start()
  DispatchQueue.main.asyncAfter(deadline:.now()+15){fputs("Native focus probe timed out\n",stderr);exit(1)}
  withExtendedLifetime(probe){app.run()}
 }
}
