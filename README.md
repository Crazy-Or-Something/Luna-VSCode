# Luna for VS Code

Luna syntax highlighting and completions for `.ln` scripts.

- Custom Luna PNG as the default icon for `.ln` files in light and dark themes.
- Canonical Lua highlighting for keywords, strings, numbers, and comments.
- Profile-aware colours for custom keywords, function aliases, and active shortcuts.
- Suggestions for common Lua functions, profile aliases, and shortcuts.
- A function-block snippet using your chosen name for `function`.
- Hover descriptions and a status bar showing the active profile.
- Live diagnostics for invalid profiles and translation conflicts.
- **Luna: Check current file** compiles the current buffer without running it.
- **Luna: Select Profile** and **Luna: Open Profiles File** commands.

Open a workspace containing `profiles/default.jsonc`. The single default profile is selected automatically.
Without a profiles file, canonical Lua suggestions remain available.
For another file or ID, configure:

```json
{
  "luna.profileFile": "profiles/example.jsonc",
  "luna.profileId": "example"
}
```

Profiles use the open editor buffer when available, so unsaved edits refresh highlighting, suggestions, and diagnostics. Otherwise they are read from disk.
Multiple profiles require selecting an ID. Invalid profiles show errors in Problems and fall back to canonical Lua suggestions.
Profile settings are scoped to each workspace folder.
Use a theme with semantic highlighting enabled to colour custom names (enabled by default for Luna).

## Install

From the Luna repository root, build a local VSIX:

```powershell
powershell -NoProfile -File extensions/luna-vscode/package.ps1
```

In VS Code, run **Extensions: Install from VSIX...** and choose `build/luna-language-0.2.0.vsix`.
Then open a `.ln` file. Use **Luna: Select Profile** to select an ID from the configured profiles file.
For the example rules, set `luna.profileFile` to `profiles/example.jsonc` and select `example`.

The package script uses PowerShell's ZIP support, with no downloaded build dependencies.
It produces a local package only; this extension has not been published to the Marketplace.

## Development

From the Luna repository root:

```powershell
node extensions/luna-vscode/sync-runtime.cjs
node --test extensions/luna-vscode/test/core.test.mjs
code --new-window --extensionDevelopmentPath="$PWD/extensions/luna-vscode" .
```

The extension bundles the same profile reader and tokenizer as the CLI; sync them after changing shared tools.
It has no npm dependencies and runs without executing your Luna scripts.
This first version does not infer types or project symbols. Unknown object members are not guessed.
Visual Luna (`.vln`), game-editor integration, playtesting, and a debugger are still planned.

## File icon

The `.ln` language icon uses `assets/icon/ln_icon.png`. File icon themes can override language icons or disable them; if it is not visible, choose a compatible theme such as Seti in **Preferences: File Icon Theme**.

## Diagnostics and syntax checks

Translation and profile errors update while you type. Only configured profile files are validated by Luna. The first error from each validator is reported; this version does not perform full scope or type analysis.

Run **Luna: Check current file** to check Lua syntax, including unsaved script edits. It compiles translated text without executing the script. Lua errors underline the original source line; columns in translated text are not mapped back. Editing the script or changing profiles clears previous syntax-check results.

Build Luna's runtime first, or set `luna.runtimePath` to the Lua executable (absolute or relative to your workspace). Auto-detection searches workspace `build/` and the sibling `../Luna/build/` directory. Launching the runtime requires a trusted workspace. Translation diagnostics remain available in restricted mode.
