# Pi Cache Hit

This plugin shows the same `CH` indicator as Pi's CLI footer: the cache-hit rate for the latest assistant message, calculated as `Cache Read / (Input + Cache Read + Cache Write)`. The composer badge refreshes during Pi turns, and pressing it shows the three token counts used in the calculation.

To obtain the latest message's counters, the daemon reads the Pi session JSONL file associated with that agent. It sends only the token counts and percentage to the app, never the message text, and makes no external network requests. The plugin requires the daemon to be able to read the local Pi session file. Until Pi reports usable cache counters, the badge shows `CH—`. The interface follows Paseo’s selected language and supports English, Arabic, Spanish, French, Japanese, Korean, Brazilian Portuguese, Russian, and Simplified Chinese; other languages fall back to English.
