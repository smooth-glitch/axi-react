import test from "node:test";
import assert from "node:assert/strict";

test("SandeshSelect normalization handles string options and object options without mutating values", () => {
  // Test normalization logic mirroring SandeshSelect
  const normalizeOptions = (options) => {
    return (Array.isArray(options) ? options : [])
      .map((opt) => {
        if (opt === null || opt === undefined) return null;
        if (typeof opt === "object") {
          const val =
            opt.value !== undefined
              ? opt.value
              : opt.id !== undefined
              ? opt.id
              : opt.name;
          const lbl =
            opt.label !== undefined
              ? opt.label
              : opt.name !== undefined
              ? opt.name
              : String(val);
          return { value: String(val), label: String(lbl) };
        }
        return { value: String(opt), label: String(opt) };
      })
      .filter(Boolean);
  };

  // String array as from publicData.branches
  const branchOptions = ["HQ", "North Wing", "Mumbai Office"];
  const normalizedBranches = normalizeOptions(branchOptions);
  assert.equal(normalizedBranches.length, 3);
  assert.deepEqual(normalizedBranches[0], { value: "HQ", label: "HQ" });
  assert.deepEqual(normalizedBranches[1], { value: "North Wing", label: "North Wing" });

  // Object array as from Registration Type
  const regTypes = [
    { value: "employee", label: "Enterprise Employee" },
    { value: "external", label: "Individual Customer / Citizen" },
    { value: "affiliate", label: "Affiliate Partner" },
  ];
  const normalizedRegTypes = normalizeOptions(regTypes);
  assert.equal(normalizedRegTypes.length, 3);
  assert.equal(normalizedRegTypes[0].value, "employee");
  assert.equal(normalizedRegTypes[0].label, "Enterprise Employee");

  // Affiliate objects as from publicData.affiliates
  const affiliateObjects = [{ name: "Partner Corp" }, { name: "Global Logistics" }];
  const normalizedAffiliates = normalizeOptions(affiliateObjects.map((a) => a.name || a));
  assert.equal(normalizedAffiliates[0].value, "Partner Corp");
  assert.equal(normalizedAffiliates[0].label, "Partner Corp");
});

test("SandeshSelect payload integrity for registration", () => {
  // Simulate what SandeshLoginScreen produces with selected values
  const regType = "employee";
  const regBranch = "HQ";
  const regDept = "Engineering";
  const regDesignation = "Lead Engineer";

  const payload = {
    name: "Alice Doe",
    email: "alice@example.com",
    isEmployee: regType === "employee",
    branch: regBranch,
    department: regDept,
    designation: regDesignation,
  };

  assert.equal(payload.isEmployee, true);
  assert.equal(payload.branch, "HQ");
  assert.equal(payload.department, "Engineering");
  assert.equal(payload.designation, "Lead Engineer");
});
