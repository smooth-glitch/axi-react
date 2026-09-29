// Lets plain Node (node --test) load the app's source, which imports files without extensions ('./logger').
import { register } from "node:module";
register("./resolve-hooks.mjs", import.meta.url);
