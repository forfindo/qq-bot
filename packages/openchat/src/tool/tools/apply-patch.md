Use the `apply_patch` tool to edit files. Your patch language is a stripped‑down, file‑oriented diff format designed to be easy to parse and safe to apply. You can think of it as a high‑level envelope:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Within that envelope, you get a sequence of file operations.
You MUST include a header to specify the action you are taking.
Each operation starts with one of three headers:

*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).

*** Delete File: <path> - remove an existing file. Nothing follows.

*** Update File: <path> - patch an existing file in place (optionally with a rename).

Within an `*** Update File:` section, express each change as one or more hunks. A hunk starts with a `@@` line (optionally followed by a context header to help locate the change), then a sequence of lines prefixed with ` ` (context / keep), `-` (remove), or `+` (add).

To match the LAST occurrence of a block — for example, lines at the very end of a file that also appear earlier — end that hunk with a line reading exactly: `*** End of File`

This anchors the match to the end of the file instead of the first matching position.

Example patch:

```
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
 print("keep")
-print("Hi")
+print("Hello, world!")
*** End of File
*** Update File: tail.txt
*** Delete File: obsolete.txt
*** End Patch
```

It is important to remember:

- You must include a header with your intended action (Add/Delete/Update)
- You must prefix new lines with `+` even when creating a new file
- Use `*** End of File` as the last line of a `@@` hunk only when the removed lines must match at the end of the file
- The modified content MUST maintain the same indentation format as the original file.
