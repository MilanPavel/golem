# The terminal demo, recorded by VHS (`just demo-tui`). The real TUI and daemon, with the
# scripted model from packages/web/e2e/demo-scenario.ts. DEMO_ENV is the file demo-stack.ts
# writes: GOLEM_HOME, PATH with this checkout's golem, and the demo project as the folder.

Output scripts/demo/out/tui.mp4

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 22
Set LineHeight 1.25
Set Width 1600
Set Height 960
Set Padding 32
Set Framerate 30
Set TypingSpeed 45ms
Set CursorBlink false
# Kiln, golem's dark palette, as a terminal theme.
Set Theme { "name": "golem-kiln", "background": "#1D1915", "foreground": "#EEE7DF", "cursor": "#D08549", "selection": "#2E2118", "black": "#15120F", "red": "#D9785F", "green": "#8DB580", "yellow": "#E0B45E", "blue": "#7FA3C4", "magenta": "#C99AB8", "cyan": "#7DB8B0", "white": "#EEE7DF", "brightBlack": "#8F877E", "brightRed": "#E89279", "brightGreen": "#A5C999", "brightYellow": "#EBC67A", "brightBlue": "#9AB9D6", "brightMagenta": "#D9B1CB", "brightCyan": "#97CBC4", "brightWhite": "#FFFFFF" }

Hide
Type `source "$DEMO_ENV" && export PS1='~/my-project $ ' && clear`
Enter
Sleep 500ms
Show

Sleep 600ms
Type "golem"
Enter
Wait+Screen@20s /qwen3-coder:30b/
Sleep 1.2s

Type "The tests fail on an empty list. Can you fix it?"
Sleep 600ms
Enter

# The edit: read the diff, then allow it once.
Wait+Screen@20s /Allow edit_file/
Sleep 3s
Type "a"

# The test run: read the command, then allow it once.
Wait+Screen@20s /Allow shell/
Sleep 2.2s
Type "a"

Wait+Screen@30s /All three tests pass/
Sleep 4s
