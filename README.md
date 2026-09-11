# Jitsi Meet Electron SDK

SDK for integrating Jitsi Meet into Electron applications.

Supported Electron versions: >= 16.

## WorkPlus fork 说明

本包是 `@jitsi/electron-sdk@6.0.50` 的 WorkPlus 维护分支，npm 包名为
`@w6s/jitsi-electron-sdk`。目前的核心改动是修复 Electron 39 发布包中的
Always On Top（会议悬浮小窗）黑屏问题。

### 改动原因

WorkPlus 开发环境通过 `http://localhost` 加载会议页面时，Jitsi SDK 原有的
Always On Top 实现可以正常显示；macOS 发布包通过 `file://` 加载会议页面时，
Electron 39/Chromium 会将远程 Jitsi iframe 隔离到独立 renderer process。

原实现通过 Jitsi iframe API 的私有方法直接读取 iframe 中的 `document`、
`largeVideo` 和悬浮窗资源。在上述发布环境中，这些访问会抛出
`SecurityError: Blocked a frame with origin "file://" from accessing a cross-origin frame`。
因此悬浮窗本身和本地关闭按钮能够创建，但会议界面、用户头像和视频内容无法完成初始化。

这个问题发生在 Electron 客户端的跨 iframe DOM 访问层，不需要调整 Jitsi 服务端。

### 兼容方式

| Electron 版本/运行环境 | Always On Top 路径 |
| --- | --- |
| Electron 22、28 | 保留上游的 `MediaStream/srcObject` 实现 |
| Electron 39+，可以访问 Jitsi iframe | 继续使用上游实现，例如本地 HTTP 开发环境 |
| Electron 39+，出现跨域 `SecurityError` | 自动切换到 WorkPlus frame bridge |

frame bridge 只在 Electron 39+ 且原生访问实际失败时开启：

1. Renderer 先探测 `_getAlwaysOnTopResources()` 和会议视频元素是否可以访问。
2. 探测成功时完全沿用上游逻辑，避免影响 Electron 22/28 和正常的 Electron 39 开发环境。
3. 探测出现跨域 `SecurityError` 时，主进程通过 `WebFrameMain.executeJavaScript()`
   在 Jitsi iframe 自己的 renderer process 中读取 `largeVideo`。
4. 视频以 640 × 360 JPEG 帧、160 ms 间隔传递到悬浮窗；悬浮窗继续复用 Jitsi
   提供的界面资源和原始 API 事件，因此关闭、返回主窗口等按钮仍然可操作。
5. bridge 同步 `hasVideo` 状态并触发 `largeVideoChanged`，确保无视频时正常显示用户头像，
   有视频时显示活动视频画面。
6. 悬浮窗隐藏、关闭或会议销毁时停止帧循环，避免后台持续抓帧。

Electron 22 和 28 已验证使用原实现；Electron 39 发布态使用兼容 bridge。
后续升级 Electron 或 Jitsi SDK 时，应同时验证 HTTP 开发入口和 `file://` 发布入口。

## Installation

Install from npm:

    npm install @w6s/jitsi-electron-sdk

Note: This package contains native code on Windows for the remote control module. Binary prebuilds are packaged with prebuildify as part of the npm package.

## Usage
#### Remote Control

**Requirements**:
The remote control utility requires iframe HTML Element that will load Jitsi Meet.

**Enable the remote control:**

In the **render** electron process of the window where Jitsi Meet is displayed:

```Javascript
const {
    RemoteControl
} = require("@w6s/jitsi-electron-sdk");

// iframe - the Jitsi Meet iframe
const remoteControl = new RemoteControl(iframe);
```

To disable the remote control:
```Javascript
remoteControl.dispose();
```

NOTE: `dispose` method will be called automatically when the Jitsi Meet iframe unload.

In the **main** electron process:

```Javascript
const {
    RemoteControlMain
} = require("@w6s/jitsi-electron-sdk");

// jitsiMeetWindow - The BrowserWindow instance of the window where Jitsi Meet is loaded.
const remoteControl = new RemoteControlMain(mainWindow);
```

#### Screen Sharing

**Requirements**:
The screen sharing utility requires iframe HTML Element that will load Jitsi Meet.

**Enable the screen sharing:**

In the **render** electron process of the window where Jitsi Meet is displayed:

```Javascript
const {
    setupScreenSharingRender
} = require("@w6s/jitsi-electron-sdk");

// api - The Jitsi Meet iframe api object.
setupScreenSharingRender(api);
```
In the **main** electron process:

```Javascript
const {
    setupScreenSharingMain
} = require("@w6s/jitsi-electron-sdk");

// jitsiMeetWindow - The BrowserWindow instance of the window where Jitsi Meet is loaded.
// appName - Application name which will be displayed inside the content sharing tracking window
// i.e. [appName] is sharing your screen.
// osxBundleId - Mac Application bundleId for which screen capturer permissions will be reset if user denied them.  
setupScreenSharingMain(mainWindow, appName, osxBundleId);
```


#### Always On Top
Displays a small window with the current active speaker video when the main Jitsi Meet window is not focused.

**Requirements**:
1. Jitsi Meet should be initialized through our [iframe API](https://github.com/jitsi/jitsi-meet/blob/master/doc/api.md)
2. The `BrowserWindow` instance where Jitsi Meet is displayed should use the [Chrome's window.open implementation](https://github.com/electron/electron/blob/master/docs/api/window-open.md#using-chromes-windowopen-implementation) (set `nativeWindowOpen` option of `BrowserWindow`'s constructor to `true`).
3. If you have a custom handler for opening windows you have to filter the always on top window. You can do this by its `frameName` argument which will be set to `AlwaysOnTop`.

**Enable the aways on top:**

In the **main** electron process:
```Javascript
const {
    setupAlwaysOnTopMain
} = require("@w6s/jitsi-electron-sdk");

// jitsiMeetWindow - The BrowserWindow instance
// of the window where Jitsi Meet is loaded.
setupAlwaysOnTopMain(jitsiMeetWindow);
```

In the **render** electron process of the window where Jitsi Meet is displayed:
```Javascript
const {
    setupAlwaysOnTopRender
} = require("@w6s/jitsi-electron-sdk");

const api = new JitsiMeetExternalAPI(...);
const alwaysOnTop = setupAlwaysOnTopRender(api);

alwaysOnTop.on('will-close', handleAlwaysOnTopClose);
```

`setupAlwaysOnTopRender` return an instance of EventEmitter with the following events:

* _dismissed_ - emitted when the always on top window is explicitly dismissed via its close button

* _will-close_ - emitted right before the always on top window is going to close


#### Power Monitor

Provides a way to query electron for system idle and receive power monitor events.

**enable power monitor:**
In the **main** electron process:
```Javascript
const {
    setupPowerMonitorMain
} = require("@w6s/jitsi-electron-sdk");

// jitsiMeetWindow - The BrowserWindow instance
// of the window where Jitsi Meet is loaded.
setupPowerMonitorMain(jitsiMeetWindow);
```

In the **render** electron process of the window where Jitsi Meet is displayed:
```Javascript
const {
    setupPowerMonitorRender
} = require("@w6s/jitsi-electron-sdk");

const api = new JitsiMeetExternalAPI(...);
setupPowerMonitorRender(api);
```

### NOTE:
You'll need to add 'disable-site-isolation-trials' switch because of [https://github.com/electron/electron/issues/18214](https://github.com/electron/electron/issues/18214):
```
app.commandLine.appendSwitch('disable-site-isolation-trials')
```

## Example

For examples of installation and usage checkout the [Jitsi Meet Electron](https://github.com/jitsi/jitsi-meet-electron) project.

## Development

Enable husky to avoid accidental pushes to the main branch:

    npx husky install

To rebuild the native code, use:

    npx node-gyp rebuild

## Publishing

On every push to main branch, the .github/workflows/ci.yml will create a new version and publish to npm.

If a major or minor release is required, use respective key words in the commit message, see https://github.com/phips28/gh-action-bump-version#workflow
