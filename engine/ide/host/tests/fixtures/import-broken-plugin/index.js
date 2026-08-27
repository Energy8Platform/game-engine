// Unlike broken-plugin (whose `apply()` throws once cordis calls it), this
// module throws while it is being imported — the failure `schemaOf()`'s
// catch is meant to distinguish from "this plugin legitimately declares no
// Config". `apply()` is never reached; nothing here even defines one.
throw new Error('this plugin fails to import on purpose');
