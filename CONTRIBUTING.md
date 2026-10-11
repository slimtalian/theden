# Contributing

Keep The Den small, understandable, and local-first. Changes should preserve keyboard and touch access, reduced-motion behavior, and the distinction between the empty local library and the public sample collection.

Use Node.js 24 and calibre. Run `npm ci`, then `npm test`. For interface or demo changes, also run `npm run build:demo`, `npm run check:public`, and `npm run preview:demo`. Check the `/theden/` subpath on desktop and a narrow viewport, including opening/closing a PDF and both reading modes.

Do not commit personal books, databases, reading-state files, runtime logs, local configuration, or screenshots containing personal content. Use the synthetic fixtures or original demo essays. Changes to the demo collection should retain clear research links and the label that these are modern sample essays.

Open a focused pull request describing the visible behavior, the checks performed, and any remaining limitations. Publication checks are useful guards, not a substitute for reviewing the exact diff and files before pushing.
