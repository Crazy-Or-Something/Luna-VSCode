# Luna for VS Code

Luna syntax highlighting and completions for `.ln` scripts.

- Custom Luna PNG as the default icon for `.ln` files in light and dark themes.
- Canonical Lua highlighting for keywords, strings, numbers, and comments.
- Profile-aware colours for custom keywords, function aliases, and active shortcuts.
- Suggestions for common Lua functions, profile aliases, and shortcuts.
- A function-block snippet using your chosen name for `function`.
- Hover descriptions and a status bar showing the active profile.
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

Profiles are read from disk. Save profile changes to refresh highlighting and suggestions.
Multiple profiles require selecting an ID. Invalid profiles show a warning and fall back to canonical Lua suggestions.
Profile settings are scoped to each workspace folder.
Use a theme with semantic highlighting enabled to colour custom names (enabled by default for Luna).

## Install

From the Luna repository root, build a local VSIX:

```powershell
powershell -NoProfile -File extensions/luna-vscode/package.ps1
```

In VS Code, run **Extensions: Install from VSIX...** and choose `build/luna-language-0.1.0.vsix`.
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
