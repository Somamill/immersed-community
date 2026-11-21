const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAnki } = require("../desktop/anki.cjs");

test("Anki v1 requests preview safely, serialize duplicate retries, and protect manual edits", async () => {
  let stored, creates = 0, writes = 0;
  const request = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:8765/api/v1");
    assert.equal(options.redirect, "error");
    const { id, method, params } = JSON.parse(options.body);
    const result = {
      "noteTypes.get": () => ({ fields: [{ name: "Front" }, { name: "Back" }] }),
      "notes.search": () => ({ ids: stored ? ["23"] : [] }),
      "notes.validate": () => ({ valid: true }),
      "notes.get": () => stored,
      "notes.create": () => { creates++; stored = { ...params }; return { noteId: "23" }; },
      "notes.update": () => { writes++; stored = { ...stored, ...params.patch }; return stored; },
    }[method]();
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  };
  const anki = createAnki({ request });
  const draft = { deck: "1", model: "4", identity: "語", fields: { Front: "語", Back: "word < text" }, tags: "study" };
  assert.equal((await anki.submit(draft)).status, "ready");
  assert.equal(creates, 0);
  assert.deepEqual(await Promise.all([1, 2].map(() => anki.submit({ ...draft, action: "add" }))),
    [{ status: "added", id: "23" }, { status: "exists", id: "23" }]);
  assert.equal(creates, 1);
  assert.equal(stored.fields.Back, "word &lt; text");
  const update = { ...draft, fields: { ...draft.fields, Back: "language" }, action: "update" };
  assert.equal((await anki.submit(update)).status, "updated");
  stored.fields.Back = "manual edit";
  assert.equal((await anki.submit(update)).status, "edited");
  assert.equal(writes, 1);
  assert.equal(stored.fields.Back, "manual edit");
});

test("Anki reports connection recovery without trying a remote endpoint", async () => {
  const anki = createAnki({ request: async () => { throw new Error("connect ECONNREFUSED"); } });
  await assert.rejects(anki.connection(), /Open Anki Desktop/);
});
