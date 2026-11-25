{
	contract: "capture@1",
	hooks: {
		// Una vez por captura, en la primera página: acepta el aviso de cookies (queda en una cookie)
		prepare: (ctx) => {
			const accept = ctx.page.document.getElementById("aceptar");
			if (accept) accept.click();
		},
		// La app está lista cuando el cuerpo lleva la clase «lista»
		ready: (ctx) => ctx.kit.until(() => ctx.page.document.body.classList.contains("lista"), 5000),
		ignore: (el) => el.classList.contains("publicidad"),
	},
}
