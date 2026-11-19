# The terminal demo, recorded by VHS (`just demo-tui`). The real TUI and daemon, with the
# scripted model from packages/web/e2e/demo-scenario.ts. DEMO_ENV is the file demo-stack.ts
# writes: GOLEM_HOME, PATH with this checkout's golem, and the demo project as the folder.
# One story: a Rust hello world with a test, then a routine that waits for you, and /runs.

Output scripts/demo/out/tui.mp4

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 22
Set LineHeight 1.25
Set Width 1600
Set Height 960
Set Padding 32
Set Framerate 30
Set TypingSpeed 32ms
Set CursorBlink false
# Kiln, golem's dark palette, as a terminal theme.
Set Theme { "name": "golem-kiln", "background": "#1D1915", "foreground": "#EEE7DF", "cursor": "#D08549", "selection": "#2E2118", "black": "#15120F", "red": "#D9785F", "green": "#8DB580", "yellow": "#E0B45E", "blue": "#7FA3C4", "magenta": "#C99AB8", "cyan": "#7DB8B0", "white": "#EEE7DF", "brightBlack": "#8F877E", "brightRed": "#E89279", "brightGreen": "#A5C999", "brightYellow": "#EBC67A", "brightBlue": "#9AB9D6", "brightMagenta": "#D9B1CB", "brightCyan": "#97CBC4", "brightWhite": "#FFFFFF" }

Hide
Type `source "$DEMO_ENV" && export PS1='~/rust-hello $ ' && clear`
Enter
Sleep 500ms
Show

Sleep 300ms
Type "golem tui"
Enter
Wait+Screen@20s /qwen3-coder:30b/
Sleep 0.5s

Type "Make a hello world app in Rust, with a test, and run it."
Sleep 600ms
Enter

# The two files: read each diff, then allow it once.
Wait+Screen@20s /Allow write_file/
Sleep 1.5s
Type "a"
Wait+Screen@20s /main.rs/
Sleep 1.5s
Type "a"

# The test run: read the command, then allow it once.
Wait+Screen@20s /Allow shell/
Sleep 1.5s
Type "a"

Wait+Screen@60s /Hello, world!/
Sleep 1.2s

# A receipt lands in a watched folder, and its routine stops to ask: the banner says so.
Wait+Screen@60s /needs you/
Sleep 2s
Type "/runs"
Sleep 600ms
Enter
Sleep 3.5s
