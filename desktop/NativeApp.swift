import Cocoa
import WebKit
import MediaPlayer
import UniformTypeIdentifiers
import Vision
import QuartzCore
import CoreImage
import Security

// GitHub builds have no stable Developer ID. WebKit's default WebCrypto
// wrapping key otherwise consults Keychain after every native binary update.
// Keep wrapping keys in memory instead; never read or change the user's Keychain.
// WebKit SPI is checked before use; unsupported systems use a private store.
@MainActor
final class BrowserSession: NSObject {
    let store: WKWebsiteDataStore
    private let cryptoKey: Data
    private var netflixPrepared = false
    private(set) var keyRequests = 0
    override init() {
        var bytes = [UInt8](repeating: 0, count: 16)
        precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
        cryptoKey = Data(bytes)
        let persistent = WKWebsiteDataStore.default()
        if #available(macOS 15.0, *), persistent.responds(to: NSSelectorFromString("set_delegate:")) {
            store = persistent
        } else { store = .nonPersistent() }
        super.init()
        if store.isPersistent { store.perform(NSSelectorFromString("set_delegate:"), with: self) }
    }
    @objc(webCryptoMasterKey:)
    func webCryptoMasterKey(_ completion: @escaping (Data) -> Void) {
        keyRequests += 1
        completion(cryptoKey)
    }
    func prepareNetflix(completion: @escaping () -> Void) {
        guard !netflixPrepared else { completion(); return }
        netflixPrepared = true
        // Old encrypted player databases cannot be opened with this session's
        // key. Renew just Netflix's playback caches; keep cookies and app data.
        var types: Set<String> = [WKWebsiteDataTypeIndexedDBDatabases, WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeServiceWorkerRegistrations]
        if #available(macOS 14.0, *) { types.insert(WKWebsiteDataTypeMediaKeys) }
        store.fetchDataRecords(ofTypes: types) { [weak self] records in
            guard let self else { return }
            let netflix = records.filter { $0.displayName == "netflix.com" || $0.displayName.hasSuffix(".netflix.com") || $0.displayName == "nflxvideo.net" || $0.displayName.hasSuffix(".nflxvideo.net") }
            guard !netflix.isEmpty else { completion(); return }
            self.store.removeData(ofTypes: types, for: netflix, completionHandler: completion)
        }
    }
    func renewNetflix() { netflixPrepared = false }
}

@MainActor
final class NetflixFocusView: NSView {
    var studyHeight: NSLayoutConstraint?
    var expanded = false {
        didSet { studyHeight?.constant = expanded ? 620 : 190; needsLayout = true }
    }
    var exitButton: NSButton?
    var hideChrome: DispatchWorkItem?
    func mount(movie: WKWebView, study: WKWebView, exit button: NSButton) {
        for view in [movie as NSView, study as NSView, button as NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        let width = study.widthAnchor.constraint(equalToConstant: 960)
        width.priority = .defaultLow
        let height = study.heightAnchor.constraint(equalToConstant: 190)
        height.priority = .defaultLow; studyHeight = height
        NSLayoutConstraint.activate([
            movie.leadingAnchor.constraint(equalTo: leadingAnchor), movie.trailingAnchor.constraint(equalTo: trailingAnchor),
            movie.topAnchor.constraint(equalTo: topAnchor), movie.bottomAnchor.constraint(equalTo: bottomAnchor),
            study.centerXAnchor.constraint(equalTo: centerXAnchor), study.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -80),
            width, study.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -48), height,
            study.topAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.topAnchor, constant: 12),
            button.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24), button.topAnchor.constraint(equalTo: topAnchor, constant: 20),
            button.widthAnchor.constraint(equalToConstant: 40), button.heightAnchor.constraint(equalToConstant: 40)
        ])
        exitButton = button
    }
    func revealControls() {
        hideChrome?.cancel(); exitButton?.alphaValue = 1
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.22
                    context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                self.exitButton?.animator().alphaValue = 0
            }
        }
        hideChrome = work; DispatchQueue.main.asyncAfter(deadline: .now() + 1.8, execute: work)
    }
}

// Core Animation composites the page trails and light sweep locally; no video asset is loaded.
final class StartupArtworkView: NSView {
    init(animate: Bool) {
        super.init(frame: NSRect(x: 0, y: 0, width: 180, height: 160))
        wantsLayer = true
        let mint = NSColor(calibratedRed: 0.70, green: 0.87, blue: 0.77, alpha: 1)
        for i in 0..<3 {
            let page = CAShapeLayer()
            let y = CGFloat(34 + i * 12)
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 16, y: y + 20))
            path.addCurve(to: CGPoint(x: 90, y: y), control1: CGPoint(x: 46, y: y + 25), control2: CGPoint(x: 66, y: y + 18))
            path.addCurve(to: CGPoint(x: 164, y: y + 20), control1: CGPoint(x: 114, y: y + 18), control2: CGPoint(x: 134, y: y + 25))
            page.path = path; page.fillColor = nil; page.strokeColor = mint.cgColor
            page.lineWidth = 1.5; page.lineCap = .round; page.opacity = 0.18
            layer?.addSublayer(page)
            if animate {
                let draw = CAKeyframeAnimation(keyPath: "strokeEnd")
                draw.values = [0, 1, 1]; draw.keyTimes = [0, 0.48, 1]
                let fade = CAKeyframeAnimation(keyPath: "opacity")
                fade.values = [0, 0.8, 0]; fade.keyTimes = [0, 0.45, 1]
                let rise = CABasicAnimation(keyPath: "transform.translation.y")
                rise.fromValue = -5; rise.toValue = 5
                let group = CAAnimationGroup(); group.animations = [draw, fade, rise]
                group.duration = 2.4; group.beginTime = CACurrentMediaTime() + Double(i) * 0.18
                group.repeatCount = .infinity; group.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                page.add(group, forKey: "pages")
            }
        }
        if let url = Bundle.main.url(forResource: "ImmersedMac", withExtension: "icns"), let image = NSImage(contentsOf: url),
           let raw = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            // The app icon has a black tile; its green channel supplies a clean glyph alpha.
            let input = CIImage(cgImage: raw)
            let mask = input.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 1.5, z: 0, w: 0)])
            if let glyph = CIContext().createCGImage(mask, from: input.extent) {
                let mark = CALayer(); mark.contents = glyph; mark.contentsGravity = .resizeAspect
                mark.frame = CGRect(x: 48, y: 66, width: 84, height: 84); layer?.addSublayer(mark)
                if animate {
                    let appear = CABasicAnimation(keyPath: "transform.scale")
                    appear.fromValue = 0.9; appear.toValue = 1; appear.duration = 0.45
                    appear.timingFunction = CAMediaTimingFunction(name: .easeOut); mark.add(appear, forKey: "arrive")
                    let light = CALayer(); light.frame = mark.frame
                    let cutout = CALayer(); cutout.frame = light.bounds; cutout.contents = glyph
                    light.mask = cutout
                    let sweep = CAGradientLayer(); sweep.frame = CGRect(x: -84, y: 0, width: 252, height: 84)
                    sweep.colors = [NSColor.clear.cgColor, NSColor.white.withAlphaComponent(0.65).cgColor, NSColor.clear.cgColor]
                    sweep.startPoint = CGPoint(x: 0, y: 0.5); sweep.endPoint = CGPoint(x: 1, y: 0.5)
                    light.addSublayer(sweep); layer?.addSublayer(light)
                    let glide = CABasicAnimation(keyPath: "transform.translation.x")
                    glide.fromValue = -100; glide.toValue = 100; glide.duration = 2.4; glide.repeatCount = .infinity
                    sweep.add(glide, forKey: "light")
                }
            }
        }
        setAccessibilityElement(true); setAccessibilityLabel("immersed is opening")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var service: Process?
    var serviceLifetime: FileHandle?
    var loading: NSView!
    var previewingStartup = false
    var attempts = 0
    var startupErrorShown = false
    private var creditsRequested = false
    private var updatesRequested = false
    var browserWindows: [NSWindow] = []
    var webViews: [WKWebView] = []
    var adRules: WKContentRuleList?
    var pendingFiles: [URL] = []
    var terminating = false
    var ready = false
    var captionScanBusy = false
    var gestureMonitor: Any?
    var gestureX: CGFloat = 0
    var gestureY: CGFloat = 0
    var gestureFired = false
    let browserSession = BrowserSession()
    var netflixView: WKWebView?
    var netflixSplit: NSSplitView?
    var netflixFocus: NetflixFocusView?
    var netflixWasFullscreen = false
    let home = ProcessInfo.processInfo.environment["IMMERSED_APP_HOME"].map { URL(fileURLWithPath: $0, isDirectory: true) }
        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Immersed Mac")
    let servicePort = ProcessInfo.processInfo.environment["IMMERSED_MAC_PORT"].flatMap(UInt16.init).flatMap { $0 == 0 ? nil : $0 } ?? 4765
    var serviceURL: String { "http://127.0.0.1:\(servicePort)" }
    var blockAds: Bool { UserDefaults.standard.object(forKey: "blockAds") as? Bool ?? true }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        setupPlaybackCommands()
        gestureMonitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .swipe, .mouseMoved]) { [weak self] event in
            guard let self, event.window === self.window,
                  self.web?.url?.host == "127.0.0.1" else { return event }
            if event.type == .mouseMoved { self.netflixFocus?.revealControls(); return event }
            if event.type == .swipe {
                guard abs(event.deltaX) > abs(event.deltaY) else { return event }
                self.web.evaluateJavaScript("window.immersedTrackpad?.(\(event.deltaX < 0 ? 1 : -1))", completionHandler: nil)
                return nil
            }
            guard event.hasPreciseScrollingDeltas, event.momentumPhase.isEmpty else { return event }
            if event.phase.contains(.began) { self.gestureX = 0; self.gestureY = 0; self.gestureFired = false }
            self.gestureX += event.scrollingDeltaX; self.gestureY += event.scrollingDeltaY
            let horizontal = abs(self.gestureX) > 18 && abs(self.gestureX) > abs(self.gestureY) * 1.5
            if horizontal && !self.gestureFired && abs(self.gestureX) >= 75 {
                self.gestureFired = true
                self.web.evaluateJavaScript("window.immersedTrackpad?.(\(self.gestureX < 0 ? 1 : -1))", completionHandler: nil)
            }
            return horizontal ? nil : event
        }
        web = makeWebView()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "immersed."
        window.delegate = self; window.acceptsMouseMovedEvents = true
        window.styleMask.insert(.fullSizeContentView)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.backgroundColor = NSColor(calibratedRed: 16/255, green: 25/255, blue: 19/255, alpha: 1)
        window.isMovableByWindowBackground = true
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 800, height: 600)
        let surface = NSView(frame: window.contentView!.bounds)
        web.frame = surface.bounds; web.autoresizingMask = [.width, .height]; surface.addSubview(web)
        window.contentView = surface
        window.center()
        window.setFrameAutosaveName("immersed.main")
        showStartupAnimation()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        connect()
        let rules = #"[{"trigger":{"url-filter":"^https?://([^/]+\\.)?(doubleclick\\.net|googlesyndication\\.com|googleadservices\\.com)/"},"action":{"type":"block"}},{"trigger":{"url-filter":"^https?://[^/]*youtube\\.com/(pagead/|api/stats/ads)"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "immersed.ads.v1", encodedContentRuleList: rules) { [weak self] list, error in
            guard let self else { return }
            self.adRules = list
            self.updateAdRules()
        }
    }
    func showStartupAnimation(preview: Bool = false) {
        let surface = window.contentView!
        loading = NSView(frame: surface.bounds)
        loading.autoresizingMask = [.width, .height]; loading.wantsLayer = true
        loading.layer?.backgroundColor = NSColor(calibratedRed: 16/255, green: 25/255, blue: 19/255, alpha: 1).cgColor
        surface.addSubview(loading, positioned: .above, relativeTo: web)
        let artwork = StartupArtworkView(animate: preview || !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
        artwork.translatesAutoresizingMaskIntoConstraints = false
        loading.addSubview(artwork)
        NSLayoutConstraint.activate([
            artwork.centerXAnchor.constraint(equalTo: loading.centerXAnchor), artwork.centerYAnchor.constraint(equalTo: loading.centerYAnchor),
            artwork.widthAnchor.constraint(equalToConstant: 180), artwork.heightAnchor.constraint(equalToConstant: 160)
        ])
    }
    func dismissStartupAnimation() {
        guard loading?.superview != nil else { return }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.22
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            loading.animator().alphaValue = 0
        }, completionHandler: { [weak self] in Task { @MainActor in self?.loading.removeFromSuperview() } })
    }
    @objc func previewStartupAnimation() {
        guard ready, loading?.superview == nil, !previewingStartup else { return }
        previewingStartup = true; showStartupAnimation(preview: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.previewingStartup = false; self?.dismissStartupAnimation()
        }
    }
    func startupFailed(_ detail: String) {
        guard !startupErrorShown else { return }
        startupErrorShown = true
        loading.layer?.removeAllAnimations()
        let error = NSAlert()
        error.messageText = "Immersed could not start"
        error.informativeText = detail
        error.addButton(withTitle: "Retry")
        error.addButton(withTitle: "Close")
        error.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .alertFirstButtonReturn else { return }
            if self.service?.isRunning == false { self.service = nil }
            self.attempts = 0
            self.startupErrorShown = false
            self.connect()
        }
    }
    func buildMenu() {
        let menu = NSMenu()
        func submenu(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let sub = NSMenu(title: title); item.submenu = sub; menu.addItem(item); return sub
        }
        func item(_ sub: NSMenu, _ title: String, _ action: Selector, _ key: String) {
            sub.addItem(withTitle: title, action: action, keyEquivalent: key).target = self
        }
        let appMenu = submenu("immersed.")
        item(appMenu, "About Immersed.", #selector(showCredits), "")
        item(appMenu, "Check for Updates…", #selector(showAppUpdates), "")
        appMenu.addItem(.separator())
        item(appMenu, "Settings…", #selector(settings), ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit immersed.", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = submenu("File")
        item(file, "Open video or audiobook…", #selector(openMedia), "o")
        item(file, "Library", #selector(library), "2")
        item(file, "Close window", #selector(closeStudy), "w")
        let edit = submenu("Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Cut", "cut:", "x"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let view = submenu("View")
        item(view, "Search", #selector(focusSearch), "l")
        item(view, "Study window", #selector(showStudy), "1")
        item(view, "Saved words", #selector(words), "3")
        item(view, "Browse YouTube (unfiltered)", #selector(browseYouTube), "b")
        item(view, "Netflix", #selector(browseNetflix), "")
        item(view, "Preview Startup Animation", #selector(previewStartupAnimation), "")
        let fullscreen = view.addItem(withTitle: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.control, .command]
        NSApp.mainMenu = menu
    }
    @objc private func showAppUpdates() {
        showStudy()
        if ready { web.evaluateJavaScript("window.immersedCheckForUpdates?.()", completionHandler: nil) }
        else { updatesRequested = true }
    }
    @objc private func showCredits() {
        showStudy()
        if ready {
            web.evaluateJavaScript("window.showSettings?.(true)", completionHandler: nil)
        } else {
            creditsRequested = true
        }
    }

    func makeWebView(configuration: WKWebViewConfiguration? = nil) -> WKWebView {
        let config = configuration ?? WKWebViewConfiguration()
        config.websiteDataStore = browserSession.store
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        config.userContentController.add(self, name: "immersed")
        config.userContentController.add(self, name: "immersedPlayer")
        let backup = UserDefaults.standard.dictionary(forKey: "studyStorageBackup") as? [String: String] ?? [:]
        if let data = try? JSONSerialization.data(withJSONObject: backup), let json = String(data: data, encoding: .utf8) {
            let storageBridge = """
            (() => {
              if (location.hostname !== '127.0.0.1' || location.port !== '\(servicePort)') return;
              try { for (const [key,value] of Object.entries(\(json))) if (localStorage.getItem(key) === null) localStorage.setItem(key,value); } catch {}
              let timer;
              const save = () => { try { const values={}; for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith('immersed.'))values[key]=localStorage.getItem(key);} window.webkit.messageHandlers.immersed.postMessage({action:'studyStorage',values}); } catch {} };
              for (const name of ['setItem','removeItem','clear']) {
                const original=Storage.prototype[name];
                Storage.prototype[name]=function(...args){const result=original.apply(this,args);if(this===localStorage){clearTimeout(timer);timer=setTimeout(save,150);}return result;};
              }
              window.addEventListener('pagehide',save); document.addEventListener('DOMContentLoaded',save,{once:true});
            })();
            """
            config.userContentController.addUserScript(WKUserScript(source: storageBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if let file = Bundle.main.url(forResource: "player-bridge", withExtension: "js"), let code = try? String(contentsOf: file, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: code, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
        if blockAds, let rules = adRules { config.userContentController.add(rules) }
        let view = WKWebView(frame: .zero, configuration: config)
        // CSS controls opacity; the study WKWebView must not paint an opaque
        // backing rectangle over Netflix in fullscreen.
        view.underPageBackgroundColor = .clear
        if view.responds(to: NSSelectorFromString("_setDrawsBackground:")) { view.setValue(false, forKey: "drawsBackground") }
        view.uiDelegate = self; view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = false
        webViews.append(view)
        return view
    }
    func updateAdRules() {
        for view in webViews {
            view.configuration.userContentController.removeAllContentRuleLists()
            if blockAds, let rules = adRules { view.configuration.userContentController.add(rules) }
        }
    }
    @objc func closeStudy() { window.close() }
    @objc func showStudy() { window.deminiaturize(nil); window.makeKeyAndOrderFront(nil); if !ready { connect() } }
    @objc func focusSearch() { showStudy(); web.evaluateJavaScript("document.getElementById('query')?.focus()", completionHandler: nil) }
    @objc func settings() { showStudy(); web.evaluateJavaScript("window.showSettings?.()", completionHandler: nil) }
    @objc func library() { showStudy(); web.evaluateJavaScript("window.showLibrary?.()", completionHandler: nil) }
    @objc func words() { showStudy(); web.evaluateJavaScript("window.showWords?.()", completionHandler: nil) }
    @objc func openMedia() {
        let panel = NSOpenPanel()
        panel.title = "Open Japanese video or audiobook"
        panel.allowedContentTypes = ["mp4", "m4v", "mov", "m4b", "m4a", "mp3", "wav", "aac", "flac", "ogg", "webm"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.importMedia(url)
        }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { if ready { importMedia(url) } else { pendingFiles.append(url) } }
    }
    func importMedia(_ file: URL) {
        guard ready else { pendingFiles.append(file); return }
        showStudy()
        var components = URLComponents(string: serviceURL + "/api/desktop/import")!
        components.queryItems = [URLQueryItem(name: "name", value: file.lastPathComponent)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("1", forHTTPHeaderField: "X-Immersed-Request")
        request.timeoutInterval = 3600
        web.evaluateJavaScript("document.getElementById('status').textContent = 'Importing local media…'", completionHandler: nil)
        URLSession.shared.uploadTask(with: request, fromFile: file) { [weak self] data, response, error in
            Task { @MainActor in
                guard let self else { return }
                do {
                    if let error { throw error }
                    guard let data, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NSError(domain: "immersed", code: 1, userInfo: [NSLocalizedDescriptionKey: "No import response was received."]) }
                    guard (response as? HTTPURLResponse)?.statusCode == 201, let id = object["id"] as? String else { throw NSError(domain: "immersed", code: 2, userInfo: [NSLocalizedDescriptionKey: object["error"] as? String ?? "This file could not be imported."]) }
                    let encoded = String(data: try JSONSerialization.data(withJSONObject: [id]), encoding: .utf8)!
                    self.web.evaluateJavaScript("window.openLocalMedia?.(...\(encoded))", completionHandler: nil)
                } catch {
                    self.web.evaluateJavaScript("""
                        if (document.getElementById('status')?.textContent === 'Importing local media…')
                            status('Import failed. Open another file to try again.', true);
                        """, completionHandler: nil)
                    self.alert("Import failed", error.localizedDescription)
                }
            }
        }.resume()
    }
    func alert(_ title: String, _ detail: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = detail; alert.beginSheetModal(for: window)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "immersedPlayer" {
            guard message.webView === web, ["www.youtube.com", "www.youtube-nocookie.com"].contains(message.frameInfo.request.url?.host ?? ""),
                  message.frameInfo.request.url?.path.hasPrefix("/embed/") == true,
                  let object = message.body as? [String: Any], let direction = object["direction"] as? Int, [-1,1].contains(direction) else { return }
            web.evaluateJavaScript("window.immersedPlayback?.('skip',\(direction))", completionHandler: nil)
            return
        }
        if message.name == "immersedNetflix" {
            guard message.frameInfo.isMainFrame, message.webView === netflixView,
                  ["www.netflix.com", "netflix.com"].contains(message.frameInfo.request.url?.host ?? ""),
                  let payload = message.body as? [String: Any],
                  ["state", "cues", "line", "reset", "tracks", "error", "shortcut"].contains(payload["event"] as? String ?? ""),
                  let data = try? JSONSerialization.data(withJSONObject: payload), data.count <= 8 * 1024 * 1024,
                  let json = String(data: data, encoding: .utf8) else { return }
            if payload["event"] as? String == "shortcut" {
                if payload["command"] as? String == "wordStatus", let key = payload["key"] as? String, ["1","2","3","4"].contains(key) { web.evaluateJavaScript("window.immersedWordShortcut?.(\(key.debugDescription))", completionHandler: nil) }
                else if payload["command"] as? String == "fullscreen" { toggleNetflixFullscreen() }
                else if payload["command"] as? String == "exitFullscreen" { exitNetflixFullscreen() }
                else if let command = payload["command"] as? String, ["previousWord", "nextWord"].contains(command) {
                    web.evaluateJavaScript("window.immersedPlayback?.('word',\(command == "previousWord" ? -1 : 1))", completionHandler: nil)
                }
                else if payload["command"] as? String == "replay" { web.evaluateJavaScript("window.immersedPlayback?.('replay')", completionHandler: nil) }
                else if let command = payload["command"] as? String, ["previous", "next"].contains(command) {
                    web.evaluateJavaScript("window.immersedPlayback?.('skip',\(command == "previous" ? -1 : 1))", completionHandler: nil)
                }
                return
            }
            if payload["event"] as? String == "error", netflixFocus != nil { exitNetflixFullscreen() }
            web.evaluateJavaScript("window.immersedNetflixEvent?.(\(json))", completionHandler: nil)
            return
        }
        guard message.frameInfo.isMainFrame, message.webView === web,
              message.frameInfo.request.url?.host == "127.0.0.1",
              let object = message.body as? [String: Any], let action = object["action"] as? String else { return }
        if action == "openNetflix" {
            openNetflix(object["url"] as? String)
        } else if action == "closeNetflix" {
            closeNetflixPlayer()
        } else if action == "netflixRepair" {
            let url = netflixView?.url?.absoluteString
            closeNetflixPlayer(); browserSession.renewNetflix(); openNetflix(url)
        } else if action == "netflixSafari" {
            guard let url = netflixView?.url, url.scheme == "https", ["netflix.com", "www.netflix.com"].contains(url.host ?? ""),
                  let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") else { return }
            netflixView?.evaluateJavaScript("window.immersedNetflixCommand?.({command:'pause'})", completionHandler: nil)
            NSWorkspace.shared.open([url], withApplicationAt: safari, configuration: NSWorkspace.OpenConfiguration())
        } else if action == "studyStorage", let values = object["values"] as? [String: String],
                  values.count <= 64, values.keys.allSatisfy({ $0.hasPrefix("immersed.") }),
                  let encoded = try? JSONSerialization.data(withJSONObject: values), encoded.count <= 6_000_000 {
            UserDefaults.standard.set(values, forKey: "studyStorageBackup")
        } else if action == "netflixFullscreen" {
            toggleNetflixFullscreen()
        } else if action == "netflixLookup", let open = object["open"] as? Bool, let focus = netflixFocus {
            focus.expanded = open; focus.needsLayout = true
            focus.layoutSubtreeIfNeeded()
        } else if action == "netflixCommand", let command = object["command"] as? String,
                  ["play", "pause", "seek", "rate", "language", "original", "snapshot", "subtitles", "hoverStart", "hoverEnd", "hoverCancel"].contains(command),
                  let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data: data, encoding: .utf8) {
            netflixView?.evaluateJavaScript("window.immersedNetflixCommand?.(\(json))", completionHandler: nil)
        } else if action == "blockAds", let enabled = object["enabled"] as? Bool {
            UserDefaults.standard.set(enabled, forKey: "blockAds"); updateAdRules()
        } else if action == "captionFrame" { scanVideoCaption(object)
        } else if action == "playback" {
            let position = object["position"] as? Double ?? 0
            let duration = object["duration"] as? Double ?? 0
            let playing = object["playing"] as? Bool ?? false
            MPNowPlayingInfoCenter.default().nowPlayingInfo = [
                MPMediaItemPropertyTitle: object["title"] as? String ?? "immersed.",
                MPMediaItemPropertyPlaybackDuration: duration.isFinite ? duration : 0,
                MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
                MPNowPlayingInfoPropertyPlaybackRate: playing ? (object["rate"] as? Double ?? 1) : 0
            ]
            MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
        } else if action == "openMedia" { openMedia() }
        else if action == "exportSettings", let text = object["text"] as? String, text.utf8.count <= 5 * 1024 * 1024 {
            let panel = NSSavePanel(); panel.nameFieldStringValue = "immersed-settings.json"; panel.allowedContentTypes = [.json]
            panel.beginSheetModal(for: window) { [weak self] response in
                guard response == .OK, let url = panel.url else { return }
                do { try text.write(to: url, atomically: true, encoding: .utf8) }
                catch { self?.alert("Backup failed", error.localizedDescription) }
            }
        }
    }
    func deliverVideoCaption(_ key: String, _ lines: [String], _ attempt: Int, _ busy: Bool, _ confidence: Double) {
        let payload: [Any] = [key, lines, attempt, busy, confidence, 3]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.immersedVideoText?.(...\(json))", completionHandler: nil)
    }
    func scanVideoCaption(_ object: [String: Any]) {
        guard NSApp.isActive, window.isVisible,
              let key = object["key"] as? String, key.count <= 200,
              let id = object["videoId"] as? String, id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
              let at = object["at"] as? Double, at.isFinite, at >= 0, at <= 86400 else { return }
        let attempt = object["attempt"] as? Int ?? 0
        if captionScanBusy { deliverVideoCaption(key, [], attempt, true, 1); return }
        captionScanBusy = true
        var components = URLComponents(string: serviceURL + "/api/desktop/caption-frames")!
        components.queryItems = [URLQueryItem(name: "videoId", value: id), URLQueryItem(name: "at", value: String(at))]
        var query = URLRequest(url: components.url!); query.timeoutInterval = 40
        URLSession.shared.dataTask(with: query) { [weak self] data, _, _ in
            var observations: [[String]] = []
            var confidences: [Double] = []
            var busy = false
            if let data, let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let frames = result["frames"] as? [String] {
                busy = result["busy"] as? Bool ?? false
                for encoded in frames.prefix(3) {
                    guard let imageData = Data(base64Encoded: encoded), imageData.count < 2_000_000,
                          let image = NSImage(data: imageData), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
                    // Isolate the caption band before recognition. Dense book
                    // covers and signage can otherwise suppress the bottom line.
                    let strip = cg.cropping(to: CGRect(x: 0, y: CGFloat(cg.height) * 0.80, width: CGFloat(cg.width), height: CGFloat(cg.height) * 0.20)) ?? cg
                    let request = VNRecognizeTextRequest()
                    request.recognitionLevel = .accurate
                    request.recognitionLanguages = ["ja-JP", "en-US"]
                    request.usesLanguageCorrection = true
                    request.minimumTextHeight = 0.025
                    do { try VNImageRequestHandler(cgImage: strip).perform([request]) } catch { }
                    var confidence = 1.0
                    let lines = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }.compactMap { observation -> String? in
                        guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.45,
                              candidate.string.range(of: "[ぁ-ゖァ-ヺ一-龯]", options: .regularExpression) != nil else { return nil }
                        confidence = min(confidence, Double(candidate.confidence))
                        return String(candidate.string.prefix(300))
                    }
                    observations.append(Array(lines.prefix(12))); confidences.append(confidence)
                }
            }
            while observations.count < 3 { observations.append([]); confidences.append(1) }
            let captured = observations, scores = confidences, wasBusy = busy
            Task { @MainActor in
                guard let self else { return }
                self.captionScanBusy = false
                if wasBusy { self.deliverVideoCaption(key, [], attempt, true, 1); return }
                for (index, lines) in captured.enumerated() { self.deliverVideoCaption(key, lines, attempt, false, scores[index]) }
            }
        }.resume()
    }
    func closeNetflixPlayer() {
        restoreNetflixLayout()
        netflixView?.evaluateJavaScript("window.immersedNetflixCommand?.({command:'pause'})", completionHandler: nil)
        netflixView?.stopLoading()
        netflixView?.configuration.userContentController.removeScriptMessageHandler(forName: "immersedNetflix")
        netflixView?.removeFromSuperview(); web.removeFromSuperview(); window.contentView = web
        netflixSplit = nil; netflixView = nil
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === netflixView {
            if netflixFocus != nil { exitNetflixFullscreen() }
            web.evaluateJavaScript("window.immersedNetflixEvent?.({event:'error',message:'The Netflix player stopped. Retry playback.'})", completionHandler: nil)
        }
    }
    @objc func browseNetflix() { web.evaluateJavaScript("window.openNetflix?.()", completionHandler: nil) }
    func openNetflix(_ value: String?) {
        var url = URL(string: "https://www.netflix.com/browse")!
        if let value, let candidate = URL(string: value), candidate.scheme == "https",
           ["www.netflix.com", "netflix.com"].contains(candidate.host ?? ""), candidate.user == nil, candidate.password == nil, candidate.port == nil,
           candidate.path.range(of: "^/watch/[0-9]+/?$", options: .regularExpression) != nil { url = candidate }
        if let netflixView { netflixView.load(URLRequest(url: url)); return }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = browserSession.store
        config.mediaTypesRequiringUserActionForPlayback = []
        // The bridge routes fullscreen requests to our video/lookup layout.
        config.preferences.isElementFullscreenEnabled = true
        config.userContentController.add(self, name: "immersedNetflix")
        for name in ["netflix", "netflix-bridge"] {
            if let file = Bundle.main.url(forResource: name, withExtension: "js"), let code = try? String(contentsOf: file, encoding: .utf8) {
                config.userContentController.addUserScript(WKUserScript(source: code, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
        }
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self; view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        netflixView = view
        let split = NSSplitView(frame: window.contentView!.bounds)
        split.isVertical = true; split.dividerStyle = .thin
        web.removeFromSuperview()
        split.addArrangedSubview(view); split.addArrangedSubview(web)
        window.contentView = split; netflixSplit = split
        split.adjustSubviews(); split.setPosition(split.bounds.width * 0.65, ofDividerAt: 0)
        browserSession.prepareNetflix { [weak view] in view?.load(URLRequest(url: url)) }
    }
    func enterNetflixFullscreen() {
        guard netflixFocus == nil, let movie = netflixView else { return }
        let focus = NetflixFocusView(frame: window.contentView!.bounds)
        focus.autoresizingMask = [.width, .height]
        movie.removeFromSuperview(); web.removeFromSuperview()
        let button = NSButton(image: NSImage(systemSymbolName: "arrow.down.right.and.arrow.up.left", accessibilityDescription: "Exit Netflix fullscreen")!, target: self, action: #selector(exitNetflixFullscreen))
        button.bezelStyle = .texturedRounded; button.setAccessibilityLabel("Exit Netflix fullscreen")
        focus.mount(movie: movie, study: web, exit: button)
        netflixFocus = focus; window.contentView = focus; focus.needsLayout = true; focus.layoutSubtreeIfNeeded(); focus.revealControls()
        web.evaluateJavaScript("window.immersedNetflixFullscreen?.(true)", completionHandler: nil)
        movie.evaluateJavaScript("window.immersedNetflixCommand?.({command:'fullscreenState',value:true})", completionHandler: nil)
    }
    func toggleNetflixFullscreen() {
        if netflixFocus != nil { exitNetflixFullscreen(); return }
        netflixWasFullscreen = window.styleMask.contains(.fullScreen)
        enterNetflixFullscreen()
        if !netflixWasFullscreen { window.toggleFullScreen(nil) }
    }
    func restoreNetflixLayout() {
        guard let focus = netflixFocus, let split = netflixSplit, let movie = netflixView else { return }
        focus.hideChrome?.cancel(); movie.removeFromSuperview(); web.removeFromSuperview()
        movie.translatesAutoresizingMaskIntoConstraints = true; web.translatesAutoresizingMaskIntoConstraints = true
        split.addArrangedSubview(movie); split.addArrangedSubview(web)
        window.contentView = split; netflixFocus = nil
        split.adjustSubviews(); split.setPosition(split.bounds.width * 0.65, ofDividerAt: 0)
        web.evaluateJavaScript("window.immersedNetflixFullscreen?.(false)", completionHandler: nil)
        movie.evaluateJavaScript("window.immersedNetflixCommand?.({command:'fullscreenState',value:false})", completionHandler: nil)
    }
    @objc func exitNetflixFullscreen() {
        let leaveWindow = !netflixWasFullscreen && window.styleMask.contains(.fullScreen)
        restoreNetflixLayout()
        if leaveWindow { window.toggleFullScreen(nil) }
    }
    func windowWillExitFullScreen(_ notification: Notification) { restoreNetflixLayout() }
    func windowWillEnterFullScreen(_ notification: Notification) {
        if netflixView != nil && netflixFocus == nil { netflixWasFullscreen = false; enterNetflixFullscreen() }
    }
    func windowDidResize(_ notification: Notification) { netflixFocus?.needsLayout = true }
    var lastStudyVisibility: Bool?
    func updateStudyVisibility() {
        guard ready else { return }
        let visible = window.isVisible && !window.isMiniaturized && !NSApp.isHidden && window.occlusionState.contains(.visible)
        guard visible != lastStudyVisibility else { return }
        lastStudyVisibility = visible
        web.evaluateJavaScript("window.immersedWindowVisibility?.(\(visible))", completionHandler: nil)
    }
    func windowDidMiniaturize(_ notification: Notification) { updateStudyVisibility() }
    func windowDidDeminiaturize(_ notification: Notification) { updateStudyVisibility() }
    func windowDidChangeOcclusionState(_ notification: Notification) { updateStudyVisibility() }
    func applicationDidHide(_ notification: Notification) { updateStudyVisibility() }
    func applicationDidUnhide(_ notification: Notification) { updateStudyVisibility() }

    @objc func browseYouTube() { openBrowser(URL(string: "https://www.youtube.com/?hl=ja&gl=JP")!) }
    func openBrowser(_ url: URL) {
        if let existing = browserWindows.first {
            (existing.contentView as? WKWebView)?.load(URLRequest(url: url))
            existing.makeKeyAndOrderFront(nil); return
        }
        let view = makeWebView()
        let browser = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        browser.isReleasedWhenClosed = false
        browser.title = "YouTube · immersed."; browser.contentView = view; browser.center(); browser.makeKeyAndOrderFront(nil)
        browserWindows.append(browser)
        view.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if webView === netflixView, navigationAction.targetFrame?.isMainFrame != false {
            guard url.scheme == "https", let host = url.host,
                  host == "netflix.com" || host.hasSuffix(".netflix.com") else { decisionHandler(.cancel); return }
        }
        if url.host == "accounts.google.com" {
            decisionHandler(.cancel)
            alert("Google sign-in is unavailable in the embedded player", "Google blocks sign-in in embedded web views. Public YouTube browsing, search, and local media remain available. Your browser cookies are not imported.")
            return
        }
        if webView === web, navigationAction.targetFrame?.isMainFrame == true,
           navigationAction.navigationType == .linkActivated,
           url.scheme == "mailto" || (url.scheme == "https" && (["ko-fi.com", "www.reddit.com"].contains(url.host ?? "") || (url.host == "github.com" && url.path.range(of: #"^/Somamill/immersed-community/releases/tag/v[0-9]+\.[0-9]+\.[0-9]+$"#, options: .regularExpression) != nil))) {
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
            return
        }
        if webView === web, navigationAction.targetFrame?.isMainFrame == true, url.host != "127.0.0.1", ["http","https"].contains(url.scheme ?? "") {
            decisionHandler(.cancel); openBrowser(url); return
        }
        if webView !== web, navigationAction.targetFrame?.isMainFrame == true,
           ["www.youtube.com", "m.youtube.com", "youtube.com"].contains(url.host ?? ""),
           let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value,
           id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil {
            decisionHandler(.cancel); showStudy(); web.evaluateJavaScript("window.loadVideo?.('\(id)')", completionHandler: nil); return
        }
        guard ["http", "https", "about", "blob"].contains(url.scheme ?? "") else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === web, webView.url?.host == "127.0.0.1" {
            if !ready { NSLog("Immersed study shell loaded") }
            ready = true
            lastStudyVisibility = nil
            updateStudyVisibility()
            if updatesRequested { updatesRequested = false; showAppUpdates() }
            if creditsRequested {
                creditsRequested = false
                showCredits()
            }
            if !previewingStartup { dismissStartupAnimation() }
            let files = pendingFiles; pendingFiles.removeAll()
            for file in files { importMedia(file) }
        }
    }
    func connect() {
        guard !ready, !terminating else { return }
        let url = URL(string: serviceURL + "/")!
        var request = URLRequest(url: URL(string: serviceURL + "/api/desktop/health")!); request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            Task { @MainActor in
                guard let self, !self.ready, !self.terminating else { return }
                if error == nil, let response = response as? HTTPURLResponse {
                    let serviceInfo = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: String]
                    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
                    if response.statusCode == 200, serviceInfo?["app"] == "immersed-community", serviceInfo?["version"] == version {
                        self.web.load(URLRequest(url: url))
                    } else {
                        self.startupFailed("Close any other copy of Immersed using the local service, then retry.")
                    }
                    return
                }
                if let service = self.service, !service.isRunning {
                    self.startupFailed("The local service stopped. See Library/Application Support/Immersed Mac/startup.log for details.")
                    return
                }
                if self.service == nil { self.startService() }
                self.attempts += 1
                if self.attempts < 50 { DispatchQueue.main.asyncAfter(deadline: .now() + (self.attempts < 20 ? 0.15 : 0.5)) { self.connect() } }
                else { self.startupFailed("Startup is taking longer than expected. Check the startup log in Application Support/Immersed Mac.") }
            }
        }.resume()
    }
    func legacyDeveloperID() -> Bool {
        var code: SecStaticCode?
        var requirement: SecRequirement?
        let flags = SecCSFlags(rawValue: 0)
        let rule = #"anchor apple generic and identifier "com.somamill.immersedmac" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"#
        guard SecStaticCodeCreateWithPath(Bundle.main.bundleURL as CFURL, flags, &code) == errSecSuccess,
              SecRequirementCreateWithString(rule as CFString, flags, &requirement) == errSecSuccess,
              let code, let requirement else { return false }
        return SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSDoNotValidateResources), requirement) == errSecSuccess
    }
    func startService() {
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("runtime/desktop/launch.sh")
        let launcher = ["/opt/homebrew/bin/immersed-mac", "/usr/local/bin/immersed-mac"].first(where: { FileManager.default.isExecutableFile(atPath: $0) })
        guard launcher != nil || (bundled.map { FileManager.default.fileExists(atPath: $0.path) } ?? false) else {
            startupFailed("Install with Homebrew: brew install --HEAD Somamill/immersed-community/immersed-mac"); attempts = 50; return
        }
        let process = Process()
        let lifetime = Pipe()
        process.standardInput = lifetime
        var environment = ProcessInfo.processInfo.environment
        environment["IMMERSED_PARENT_PIPE"] = "1"
        environment["IMMERSED_MAC_PORT"] = String(servicePort)
        if let bundled, FileManager.default.fileExists(atPath: bundled.path) {
            // Bundled releases predate channel markers; signed releases use this path.
            let marker = Bundle.main.url(forResource: "InstallChannel", withExtension: nil)
                .flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            environment["IMMERSED_INSTALL_CHANNEL"] = marker ?? (legacyDeveloperID() ? "direct" : "development")
            process.executableURL = URL(fileURLWithPath: "/bin/sh")
            process.arguments = [bundled.path, bundled.deletingLastPathComponent().deletingLastPathComponent().path, "--service"]
        } else {
            process.executableURL = URL(fileURLWithPath: launcher!); process.arguments = ["--service"]
        }
        process.environment = environment
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
            let log = home.appendingPathComponent("startup.log")
            FileManager.default.createFile(atPath: log.path, contents: nil)
            let handle = try FileHandle(forWritingTo: log)
            process.standardOutput = handle; process.standardError = handle
            try process.run()
            service = process
            serviceLifetime = lifetime.fileHandleForWriting
        } catch { startupFailed(error.localizedDescription); attempts = 50 }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { if webView === web { openBrowser(url) } else { webView.load(URLRequest(url: url)) } }
        return nil
    }
    func setupPlaybackCommands() {
        let commands = MPRemoteCommandCenter.shared()
        func command(_ command: MPRemoteCommand, _ action: String) {
            command.addTarget { [weak self] _ in
                Task { @MainActor in self?.web.evaluateJavaScript("window.immersedPlayback?.('\(action)')", completionHandler: nil) }
                return .success
            }
        }
        command(commands.playCommand, "play")
        command(commands.pauseCommand, "pause")
        command(commands.togglePlayPauseCommand, "toggle")
        commands.skipForwardCommand.preferredIntervals = [15]
        commands.skipBackwardCommand.preferredIntervals = [15]
        for (command, offset) in [(commands.skipForwardCommand, 15), (commands.skipBackwardCommand, -15)] {
            command.addTarget { [weak self] _ in
                Task { @MainActor in self?.web.evaluateJavaScript("window.immersedPlayback?.('skip',\(offset))", completionHandler: nil) }
                return .success
            }
        }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in self?.web.evaluateJavaScript("window.immersedPlayback?.('seek',\(position))", completionHandler: nil) }
            return .success
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showStudy(); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminating { return .terminateNow }
        terminating = true
        var replied = false
        let finish = { if !replied { replied = true; sender.reply(toApplicationShouldTerminate: true) } }
        web.callAsyncJavaScript("return await window.flushPlayback?.()", arguments: [:], in: nil, in: .page) { _ in finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: finish)
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) {
        try? serviceLifetime?.close()
        if service?.isRunning == true { service?.terminate() }
    }
}
@main
struct ImmersedMain {
    @MainActor static func main() {
        let app = NSApplication.shared, delegate = AppDelegate()
        app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
    }
}
