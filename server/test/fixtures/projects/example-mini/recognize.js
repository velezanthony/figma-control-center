{
	contract: "recognize@1",
	rules: {
		// Un botón de la web es una instancia del set «Boton» con su texto
		Boton: {
			match: (node, cls) => node.tag === "button" && cls.has("boton"),
			props: (node, cls, ctx) => ({
				variant: { tamano: "md" },
				set: { etiqueta: ctx.allText(node)[0] },
			}),
		},
	},
}
