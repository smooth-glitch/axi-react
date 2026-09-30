// Custom # commands: definition rules, visibility, running through the chat line, menu and help.
import { suite, bootstrap, seedOrg, sfx, sleep } from "./lib/harness.mjs";
const BASE = process.argv[2] || "http://localhost:8102";
const t = suite("connectum_cmdx", BASE);
const { ok } = t;

async function main() {
    const { A, connectUser } = await bootstrap(BASE);
    const [u, v] = [`cmu${sfx}`, `cmv${sfx}`];
    await seedOrg(A, [[u, "Cmd U", "Ops"], [v, "Cmd V", "Sales"]]);
    const U = await connectUser(u), V = await connectUser(v);
    await A.sd("admin.tstruct.save", { name: "visit", caption: "Visit", fields: [{ name: "who", type: "text", caption: "Who" }] });
    await A.sd("admin.option.save", { id: "visit_opt", caption: "Visit", type: "data_input", target: "visit" });
    await A.sd("admin.wizard.save", { name: "hello", caption: "Hello", steps: [{ id: "s", type: "summary" }] });
    await A.sd("admin.catalog.save", { kind: "service", name: "Consult", price: 5 });
    await A.sd("admin.catalog.save", { kind: "product", name: "Rice", price: 3 });
    const line = async (c, text, ms = 4000) => { const id = text.split(" ")[0].toLowerCase(); c.send(text); return c.wait((x) => x.type === "sd" && x.reqId === id || x.type === "error", ms); };

    t.section("Defining");
    let m = await A.sd("cmd.save", { name: "Lab", kind: "wizard", target: "hello", summary: "Start the lab wizard" });
    ok("an administrator defines a command (names are lower-cased; target spelled canonically)", m.ok && m.data.command.name === "lab" && m.data.command.owner === null && m.data.command.target === "hello", m);
    for (const [what, o] of [
        ["a built-in name", { name: "dm", kind: "wizard", target: "hello" }],
        ["a built-in alias", { name: "msg", kind: "wizard", target: "hello" }],
        ["a bad name", { name: "1x", kind: "wizard", target: "hello" }],
        ["a name with a space", { name: "my cmd", kind: "wizard", target: "hello" }],
        ["an unknown kind", { name: "zz", kind: "shell", target: "hello" }],
        ["an unknown wizard", { name: "zz", kind: "wizard", target: "ghost" }],
        ["an unknown option", { name: "zz", kind: "option", target: "ghost" }],
        ["an unknown T-Struct", { name: "zz", kind: "list", target: "ghost" }],
        ["an unknown data source", { name: "zz", kind: "datasource", target: "ghost" }],
        ["a bad catalog target", { name: "zz", kind: "catalog", target: "cars" }],
    ]) { m = await A.sd("cmd.save", o); ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error); }
    await A.sd("cmd.save", { name: "visits", kind: "list", target: "visit" });
    await A.sd("cmd.save", { name: "newvisit", kind: "tstruct", target: "visit" });
    await A.sd("cmd.save", { name: "book", kind: "option", target: "visit_opt" });
    await A.sd("cmd.save", { name: "shop", kind: "catalog", target: "all" });
    await A.sd("cmd.save", { name: "svc", kind: "catalog", target: "service" });
    await A.sd("cmd.save", { name: "salesonly", kind: "wizard", target: "hello", applicable: { departments: ["Sales"] } });
    m = await U.sd("cmd.save", { name: "mine", kind: "wizard", target: "hello" });
    ok("a person defines their own", m.ok && m.data.command.owner === u, m);
    m = await U.sd("cmd.save", { name: "lab", kind: "wizard", target: "hello" });
    ok("...but not over someone else's", !m.ok && m.error.code === "forbidden", m.error);
    m = await U.sd("cmd.save", { name: "mine2", kind: "wizard", target: "hello", applicable: { departments: ["Sales"] } });
    ok("a person's own rules are ignored (always just for them)", m.ok && Object.keys(m.data.command.applicable).length === 0, m.data);
    m = await V.sd("cmd.list");
    ok("personal commands are private", m.ok && !m.data.commands.some((c) => c.name === "mine"), m.data.commands.map((c) => c.name));
    ok("global ones are listed; Sales sees the Sales-only one, Ops doesn't", m.data.commands.some((c) => c.name === "salesonly") && !(await U.sd("cmd.list")).data.commands.some((c) => c.name === "salesonly"));

    t.section("Running through the chat line");
    m = await line(U, "#lab");
    ok("#lab starts the wizard", m && m.ok && m.action === "cmd.custom" && m.data.action === "wizard.start" && m.data.result.run.wizard === "hello", m);
    m = await line(U, "#newvisit");
    ok("a T-Struct command opens it", m && m.ok && m.data.action === "tstruct.user.open" && m.data.result.tstruct.name === "visit", m);
    m = await line(U, "#book");
    ok("an option command runs the option", m && m.ok && m.data.action === "option.run" && m.data.result.open === "tstruct", m);
    await U.sd("tstruct.submit", { tstruct: "visit", name: "visit", values: { who: "Zed Ouzo" } });
    m = await line(U, "#visits ouzo");
    ok("a list command searches with the typed text", m && m.ok && m.data.result.total === 1, m);
    m = await line(U, "#visits nothing-here");
    ok("...and finds nothing for other text", m && m.ok && m.data.result.total === 0, m);
    m = await line(U, "#shop");
    ok("a catalog command lists everything", m && m.ok && m.data.result.total === 2, m);
    m = await line(U, "#svc");
    ok("...or just one kind", m && m.ok && m.data.result.total === 1 && m.data.result.items[0].name === "Consult", m);
    m = await line(U, "#SHOP ric");
    ok("names are case-insensitive and take typed text", m && m.ok && m.data.result.total === 1, m);
    m = await line(U, "#mine");
    ok("a person's own command works for them", m && m.ok, m);
    m = await line(V, "#mine");
    ok("...but can't be run by others", m && m.ok === false && m.error.code === "not_found", m);
    m = await line(U, "#salesonly");
    ok("a command that doesn't apply to me answers not_found", m && m.ok === false && m.error.code === "not_found", m);
    ok("...while it works for Sales", (await line(V, "#salesonly"))?.ok === true);
    m = await line(U, "#nosuchthing");
    ok("a real typo still gives the usual unknown-command error with suggestions", m && m.type === "error" && m.code === "unknown_command" && Array.isArray(m.suggestions), m);
    m = await line(U, "#lab " + "x".repeat(300));
    ok("over-long input is a usage error", m && m.type === "error" && m.code === "usage", m);

    t.section("The menu, completion and help");
    U.send("/cmds");
    m = await U.wait((x) => x.type === "cmd_catalog");
    const names = m.commands.map((c) => c.name);
    ok("/cmds includes my custom commands (and not others' personal ones)", ["lab", "visits", "mine"].every((n) => names.includes(n)) && !names.includes("salesonly"), names.filter((n) => !["dm"].includes(n)).slice(-12));
    ok("...in the Custom category, with a summary and usage", (() => { const c = m.commands.find((x) => x.name === "lab"); return c.category === "custom" && c.summary === "Start the lab wizard" && c.usage === "#lab [input...]" && c.available === true; })());
    ok("the Custom category is in the category list", m.categories.some((c) => c.id === "custom"));
    U.send('/cmdcomplete {"input":"#vis","reqId":5}');
    m = await U.wait((x) => x.type === "cmd_suggestions");
    ok("typing # + letters suggests them", m.items.some((i) => i.value === "visits"), m);
    U.send("#help lab");
    m = await U.wait((x) => x.type === "cmd_help");
    ok("#help explains a custom command", m.command.name === "lab", m);
    V.send("/cmds");
    m = await V.wait((x) => x.type === "cmd_catalog");
    ok("another person's menu has theirs, not mine", m.commands.some((c) => c.name === "salesonly") && !m.commands.some((c) => c.name === "mine"));

    t.section("Changing and removing");
    m = await A.sd("cmd.save", { name: "lab", kind: "wizard", target: "hello", active: false });
    ok("a command can be switched off", m.ok, m);
    m = await line(U, "#lab");
    ok("...and then is no longer a command for people", m && m.type === "error" && m.code === "unknown_command", m);
    m = await U.sd("cmd.delete", { name: "salesonly" });
    ok("people can't delete global commands", !m.ok && m.error.code === "forbidden", m.error);
    m = await U.sd("cmd.delete", { name: "mine" });
    ok("they can delete their own", m.ok, m);
    await sleep(100);
    m = await line(U, "#mine");
    ok("and it is gone at once (no stale name)", m && m.type === "error" && m.code === "unknown_command", m);
    m = await A.sd("cmd.delete", { name: "shop" });
    ok("an administrator deletes global ones", m.ok, m);
    m = await A.sd("cmd.delete", { name: "shop" });
    ok("...once", !m.ok && m.error.code === "not_found", m.error);
    for (const c of [A, U, V]) c.close();
    t.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
