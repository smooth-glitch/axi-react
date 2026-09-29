// The chat's form logic: mirrors the server's lite-tstruct rules (conditions, hidden fields, required, submission).
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSubmission,
  displayValue,
  evalCondition,
  groupBySection,
  isFieldVisible,
  requiredErrors,
} from "../../src/features/emberChat/utils/formEngine.js";

test("evalCondition: no condition is always true", () => {
  assert.equal(evalCondition(null, {}), true);
  assert.equal(evalCondition(undefined, {}), true);
});

test("evalCondition: eq / ne", () => {
  assert.equal(evalCondition({ field: "k", op: "eq", value: "Sick" }, { k: "Sick" }), true);
  assert.equal(evalCondition({ field: "k", op: "eq", value: "Sick" }, { k: "Casual" }), false);
  assert.equal(evalCondition({ field: "k", op: "eq", value: "Sick" }, {}), false, "an empty field never equals a value");
  assert.equal(evalCondition({ field: "k", op: "ne", value: "Sick" }, { k: "Casual" }), true);
  assert.equal(evalCondition({ field: "k", op: "ne", value: "Sick" }, { k: "Sick" }), false);
});

test("evalCondition: numbers compare as numbers, not text ('10' > '9')", () => {
  assert.equal(evalCondition({ field: "n", op: "gt", value: 9 }, { n: "10" }), true);
  assert.equal(evalCondition({ field: "n", op: "gt", value: "9" }, { n: 10 }), true);
  assert.equal(evalCondition({ field: "n", op: "lt", value: 10 }, { n: "9" }), true);
  assert.equal(evalCondition({ field: "n", op: "gte", value: 10 }, { n: 10 }), true);
  assert.equal(evalCondition({ field: "n", op: "lte", value: 10 }, { n: 11 }), false);
  assert.equal(evalCondition({ field: "n", op: "eq", value: 5 }, { n: "5" }), true);
});

test("evalCondition: comparisons on an empty field are false", () => {
  for (const op of ["gt", "lt", "gte", "lte"]) assert.equal(evalCondition({ field: "n", op, value: 1 }, {}), false, op);
  assert.equal(evalCondition({ field: "n", op: "gt", value: 1 }, { n: "" }), false);
});

test("evalCondition: in / notempty, including multi-value fields", () => {
  assert.equal(evalCondition({ field: "k", op: "in", value: ["a", "b"] }, { k: "b" }), true);
  assert.equal(evalCondition({ field: "k", op: "in", value: ["a", "b"] }, { k: "c" }), false);
  assert.equal(evalCondition({ field: "k", op: "in", value: ["a", "b"] }, { k: ["x", "a"] }), true);
  assert.equal(evalCondition({ field: "k", op: "eq", value: "a" }, { k: ["x", "a"] }), true, "eq on a multi-select means 'includes'");
  assert.equal(evalCondition({ field: "k", op: "notempty" }, { k: "x" }), true);
  assert.equal(evalCondition({ field: "k", op: "notempty" }, { k: "" }), false);
  assert.equal(evalCondition({ field: "k", op: "notempty" }, { k: [] }), false);
  assert.equal(evalCondition({ field: "k", op: "notempty" }, {}), false);
});

test("evalCondition: all / any groups nest", () => {
  const c = { all: [{ field: "a", op: "eq", value: 1 }, { any: [{ field: "b", op: "eq", value: 2 }, { field: "c", op: "eq", value: 3 }] }] };
  assert.equal(evalCondition(c, { a: 1, b: 2 }), true);
  assert.equal(evalCondition(c, { a: 1, c: 3 }), true);
  assert.equal(evalCondition(c, { a: 1 }), false);
  assert.equal(evalCondition(c, { a: 9, b: 2 }), false);
});

const tstruct = {
  name: "leave",
  sections: [{ name: "sick", caption: "Sick leave", condition: { field: "kind", op: "eq", value: "Sick" } }],
  fields: [
    { name: "kind", type: "list", caption: "Kind", required: true },
    { name: "days", type: "wholenumber", caption: "Days" },
    { name: "note", type: "text", caption: "Doctor note", required: true, section: "sick" },
    { name: "extra", type: "text", caption: "Extra", required: true, condition: { field: "days", op: "gt", value: 5 } },
  ],
};

test("isFieldVisible: a field is hidden when its own OR its section's condition fails", () => {
  const note = tstruct.fields[2];
  assert.equal(isFieldVisible(note, tstruct.sections, { kind: "Casual" }), false);
  assert.equal(isFieldVisible(note, tstruct.sections, { kind: "Sick" }), true);
  const extra = tstruct.fields[3];
  assert.equal(isFieldVisible(extra, tstruct.sections, { days: 3 }), false);
  assert.equal(isFieldVisible(extra, tstruct.sections, { days: 9 }), true);
  assert.equal(isFieldVisible(tstruct.fields[0], tstruct.sections, {}), true);
});

test("requiredErrors: only VISIBLE required fields can be missing", () => {
  assert.deepEqual(Object.keys(requiredErrors(tstruct, {})), ["kind"], "hidden required fields are not demanded");
  assert.deepEqual(Object.keys(requiredErrors(tstruct, { kind: "Sick" })).sort(), ["note"]);
  assert.deepEqual(Object.keys(requiredErrors(tstruct, { kind: "Sick", note: "flu", days: 9 })), ["extra"]);
  assert.deepEqual(requiredErrors(tstruct, { kind: "Casual" }), {});
});

test("buildSubmission: drops hidden and empty values, types numbers, trims text", () => {
  const out = buildSubmission(tstruct, { kind: "Casual", days: "3", note: "should be dropped", extra: "x", ignored: 1 });
  assert.deepEqual(out, { kind: "Casual", days: 3 });
  assert.equal(typeof out.days, "number");
  const out2 = buildSubmission(tstruct, { kind: "Sick", note: "  flu  ", days: "" });
  assert.deepEqual(out2, { kind: "Sick", note: "flu" });
  const decimals = buildSubmission({ fields: [{ name: "x", type: "number" }, { name: "w", type: "wholenumber" }] }, { x: "2.5", w: "7.9" });
  assert.deepEqual(decimals, { x: 2.5, w: 7 });
  const multi = buildSubmission({ fields: [{ name: "m", type: "list", multi: true }] }, { m: ["a", "b"] });
  assert.deepEqual(multi, { m: ["a", "b"] });
});

test("groupBySection: keeps definition order, drops hidden fields and empty groups", () => {
  const groups = groupBySection(tstruct, { kind: "Sick" });
  assert.deepEqual(groups.map((g) => [g.name, g.caption, g.fields.map((f) => f.name)]), [
    ["", "", ["kind", "days"]],
    ["sick", "Sick leave", ["note"]],
  ]);
  const hidden = groupBySection(tstruct, { kind: "Casual" });
  assert.deepEqual(hidden.map((g) => g.name), [""], "the conditional section disappears entirely");
});

test("displayValue: arrays, locations, empties", () => {
  assert.equal(displayValue(["a", "b"]), "a, b");
  assert.equal(displayValue({ lat: 12.5, lng: 77.5 }), "12.5, 77.5");
  assert.equal(displayValue(null), "");
  assert.equal(displayValue(3), "3");
});
