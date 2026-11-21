const { createHash } = require("node:crypto");

const endpoint = "http://127.0.0.1:8765/api/v1";
const ownerPrefix = "immersed_note_";
const fieldsPrefix = "immersed_fields_";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const fingerprint = fields => hash(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
const escape = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]).replace(/\r?\n/g, "<br>");
const methods = ["decks.list", "noteTypes.list", "noteTypes.get", "notes.validate", "notes.search", "notes.get", "notes.create", "notes.update"];

function createAnki({ request = fetch, key = process.env.IMMERSED_ANKI_KEY } = {}) {
  let sequence = 0;
  async function call(method, params = {}) {
    const id = ++sequence;
    let response;
    try {
      response = await request(endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(3500),
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch {
      throw Error("Open Anki Desktop and install or update AnkiConnect, then retry.");
    }
    if (response.status === 401) throw Error("AnkiConnect requires its API key. Set IMMERSED_ANKI_KEY for the local service.");
    if (!response.ok) throw Error("AnkiConnect v1 is unavailable. Update the add-on and retry.");
    const body = await response.json();
    if (body.id !== id || body.jsonrpc !== "2.0") throw Error("AnkiConnect returned an incompatible response.");
    if (body.error) {
      const error = Error(String(body.error.message || "Anki rejected the request.").slice(0, 240));
      error.ankiType = body.error.data?.type;
      throw error;
    }
    return body.result;
  }
  async function connection() {
    const description = await call("api.describe");
    const supported = new Set(description?.methods?.filter(method => method.available).map(method => method.name));
    if (description?.apiMajor !== 1 || methods.some(method => !supported.has(method)))
      throw Error("Update AnkiConnect to a version with note editing and validation.");
    const [decks, models] = await Promise.all([call("decks.list"), call("noteTypes.list")]);
    return { ankiVersion: description.ankiVersion, decks, models };
  }
  async function fields(model) {
    if (!/^\d+$/.test(model || "")) throw Error("Choose a note type.");
    const type = await call("noteTypes.get", { noteType: { id: model } });
    return type.fields.map(field => field.name);
  }
  async function prepare(draft) {
    if (!draft || !/^\d+$/.test(draft.deck || "") || !/^\d+$/.test(draft.model || "") ||
        typeof draft.identity !== "string" || !draft.identity || draft.identity.length > 300 ||
        !draft.fields || Array.isArray(draft.fields) || typeof draft.fields !== "object")
      throw Error("Choose a deck, note type and field mapping.");
    const allowed = await fields(draft.model);
    const entries = Object.entries(draft.fields);
    if (!entries.length || entries.length > 20 ||
        entries.some(([name, value]) => !allowed.includes(name) || typeof value !== "string" || value.length > 8000))
      throw Error("The note fields no longer match the selected note type.");
    const tags = [...new Set(String(draft.tags || "").split(/\s+/u).filter(Boolean))];
    if (tags.length > 24 || tags.some(tag => !/^[\p{L}\p{N}_:-]{1,64}$/u.test(tag) || /^immersed_(note|fields)_/i.test(tag)))
      throw Error("Use up to 24 tags with letters, numbers, dashes, underscores or colons.");
    const values = Object.fromEntries(entries.map(([name, value]) => [name, escape(value)]));
    let attachment;
    if (draft.attachment) {
      const { field, type, data } = draft.attachment;
      const extensions = { "image/png": "png", "image/jpeg": "jpg", "audio/mpeg": "mp3", "audio/wav": "wav" };
      if (!Object.hasOwn(extensions, type) || !allowed.includes(field) ||
          typeof data !== "string" || !data || data.length > 2_800_000)
        throw Error("Choose a PNG, JPEG, MP3 or WAV up to 2 MB and map its field.");
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > 2 * 1024 * 1024 || bytes.toString("base64") !== data)
        throw Error("The attachment could not be read.");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const filename = "immersed-" + digest + "." + extensions[type];
      const markup = type.startsWith("image/") ? `<img src="${filename}">` : `[sound:${filename}]`;
      values[field] = values[field] ? values[field] + "<br>" + markup : markup;
      attachment = { filename, source: { data }, collision: "error" };
    }
    const owner = ownerPrefix + hash([draft.deck, draft.model, draft.identity.normalize("NFKC")]);
    // Hash the entire note as it was written, including unmapped fields.
    const initial = Object.fromEntries(allowed.map(name => [name, Object.hasOwn(values, name) ? values[name] : ""]));
    return {
      owner, values, attachment,
      note: { deck: { id: draft.deck }, noteType: { id: draft.model }, fields: values,
        tags: [...tags, owner, fieldsPrefix + fingerprint(initial)] },
    };
  }
  async function storeAttachment(attachment) {
    if (!attachment) return;
    try {
      const existing = await call("media.get", { filename: attachment.filename });
      if (existing.data !== attachment.source.data) throw Error("Anki has different media with the same filename.");
      return;
    } catch (error) {
      if (error.ankiType !== "notFound") throw error;
    }
    const { operationId } = await call("media.store", attachment);
    for (let attempt = 0; attempt < 25; attempt++) {
      const operation = await call("operations.get", { operationId });
      if (operation.state === "succeeded" && operation.result.filename === attachment.filename) return;
      if (["failed", "cancelled", "succeeded"].includes(operation.state))
        throw Error(operation.error?.message || "Anki could not store the attachment.");
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw Error("Anki is still storing the attachment. Check Anki and retry.");
  }
  async function exportNote(draft) {
    const { owner, values, note, attachment } = await prepare(draft);
    const found = await call("notes.search", { query: "tag:" + owner, limit: 2 });
    if (found.ids.length > 1) return { status: "duplicate" };
    if (found.ids.length === 1) {
      const id = found.ids[0], previous = await call("notes.get", { id });
      if (Object.entries(values).every(([field, value]) => previous.fields[field] === value))
        return { status: "exists", id };
      if (!previous.tags.includes(fieldsPrefix + fingerprint(previous.fields)) || previous.noteType.id !== draft.model)
        return { status: "edited", id };
      if (draft.action !== "update") return { status: "canUpdate", id };
      const updatedFields = { ...previous.fields, ...values };
      const tags = [...new Set([...previous.tags.filter(tag => !tag.startsWith(fieldsPrefix)), ...note.tags.filter(tag => !tag.startsWith(fieldsPrefix)), fieldsPrefix + fingerprint(updatedFields)])];
      await storeAttachment(attachment);
      await call("notes.update", { id, patch: { fields: values, tags } });
      return { status: "updated", id };
    }
    const validation = await call("notes.validate", { note });
    if (!validation.valid) return { status: "invalid", issues: validation.issues };
    if (draft.action !== "add") return { status: "ready" };
    await storeAttachment(attachment);
    const result = await call("notes.create", note);
    return { status: "added", id: result.noteId };
  }
  // Serialize writes so a retry cannot race a still-running request in this service.
  let exportQueue = Promise.resolve();
  function submit(draft) {
    const next = exportQueue.then(() => exportNote(draft));
    exportQueue = next.catch(() => {});
    return next;
  }
  return { connection, fields, submit };
}

module.exports = { createAnki };
