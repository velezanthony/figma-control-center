import { mount } from "svelte";
import App from "#web/App.svelte";

const target = document.getElementById("app");
if (target === null) throw new Error("Falta el contenedor #app en index.html");

mount(App, { target });
