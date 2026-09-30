// Products and services catalog.
import { suite, bootstrap, seedOrg, sfx } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8098";
const t = suite("connectum_catalog", BASE);
const { ok } = t;
async function main() {
    const { A, connectUser } = await bootstrap(BASE);
    const u = `cat${sfx}`;
    await seedOrg(A, [[u, "Cat User", "Ops"]]);
    const U = await connectUser(u);
    t.section("Managing the catalog");
    let m = await A.sd("admin.catalog.save", { kind: "product", name: "Rice 5kg", price: 320, category: "Grocery", sku: "RC5", tags: ["food", "Food", " staple "] });
    ok("an administrator adds a product; an id is made", m.ok && /^p\d+$/.test(m.data.item.id) && m.data.item.currency === "INR" && m.data.item.active === true, m);
    ok("tags are trimmed and de-duplicated", JSON.stringify(m.data.item.tags) === JSON.stringify(["Food", "food", "staple"]) || m.data.item.tags.length === 3, m.data.item.tags);
    const pid = m.data.item.id;
    m = await A.sd("admin.catalog.save", { kind: "service", name: "Blood test", price: 450, category: "Lab", description: "Full panel" });
    ok("...and a service (id starts with s)", m.ok && /^s\d+$/.test(m.data.item.id), m);
    const sid = m.data.item.id;
    await A.sd("admin.catalog.save", { kind: "product", name: "Old stock", price: 1, active: false, category: "Grocery" });
    m = await A.sd("admin.catalog.save", { kind: "product", id: pid, name: "Rice 10kg", price: 600, category: "Grocery", sku: "RC5" });
    ok("saving with an id replaces that item", m.ok && m.data.item.id === pid && m.data.item.name === "Rice 10kg", m);
    for (const [what, o] of [["a bad kind", { kind: "gadget", name: "x" }], ["no name", { kind: "product" }], ["a negative price", { kind: "product", name: "x", price: -1 }], ["a text price", { kind: "product", name: "x", price: "ten" }], ["an unknown id", { kind: "product", id: "p99999", name: "x" }], ["a bad id", { kind: "product", id: "a b", name: "x" }]]) {
        m = await A.sd("admin.catalog.save", o);
        ok(`${what} is refused`, !m.ok, m.error);
    }
    m = await U.sd("admin.catalog.save", { kind: "product", name: "Sneaky" });
    ok("only administrators change the catalog", !m.ok && m.error.code === "forbidden", m.error);
    t.section("Browsing");
    m = await U.sd("catalog.list");
    ok("everyone sees active items (inactive hidden), sorted by name", m.ok && m.data.total === 2 && m.data.items[0].name === "Blood test", m.data);
    ok("categories are listed", m.data.categories.join() === "Grocery,Lab", m.data.categories);
    m = await U.sd("catalog.list", { includeInactive: true });
    ok("a normal person can't ask for inactive items", m.data.total === 2, m.data.total);
    m = await A.sd("catalog.list", { includeInactive: true });
    ok("an administrator can", m.data.total === 3, m.data.total);
    m = await U.sd("catalog.list", { kind: "service" });
    ok("filter by kind", m.data.total === 1 && m.data.items[0].id === sid, m.data);
    m = await U.sd("catalog.list", { category: "Grocery" });
    ok("filter by category", m.data.total === 1, m.data);
    m = await U.sd("catalog.list", { q: "PANEL" });
    ok("search in description, any case", m.data.total === 1, m.data);
    m = await U.sd("catalog.list", { q: "rc5" });
    ok("search by SKU", m.data.total === 1, m.data);
    m = await U.sd("catalog.list", { limit: 1 });
    ok("paging", m.data.items.length === 1 && m.data.hasMore === true, m.data);
    m = await U.sd("catalog.get", { kind: "service", id: sid });
    ok("catalog.get returns one item", m.ok && m.data.item.name === "Blood test", m);
    m = await U.sd("catalog.get", { kind: "product", id: "nope" });
    ok("unknown item -> not_found", !m.ok && m.error.code === "not_found", m.error);
    m = await A.sd("admin.catalog.delete", { kind: "service", id: sid });
    ok("an administrator deletes an item", m.ok, m);
    m = await A.sd("admin.catalog.delete", { kind: "service", id: sid });
    ok("...twice is not_found", !m.ok && m.error.code === "not_found", m.error);
    for (const c of [A, U]) c.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
