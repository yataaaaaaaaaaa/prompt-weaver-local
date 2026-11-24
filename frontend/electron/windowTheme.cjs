// Background color of the Electron window: the renderer's surface color (FluentProvider background,
// tokens.colorNeutralBackground2) of the Fluent 2 web theme matching the OS scheme, so the window never
// flashes another color while loading. @fluentui/react-theme is the package @fluentui/react-components
// re-exports its themes from; requiring it directly avoids loading every component in the main process.
const { webDarkTheme, webLightTheme } = require('@fluentui/react-theme');

/** @param {boolean} dark */
function windowBackgroundColor(dark) {
	return (dark ? webDarkTheme : webLightTheme).colorNeutralBackground2;
}

module.exports = { windowBackgroundColor };
