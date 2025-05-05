import { glob } from "astro/loaders";
import { z, defineCollection } from "astro:content";

const blog = defineCollection({
    loader: glob({ pattern: '**/[^_]*.md', base: "./src/writing" }),
    schema: z.object({
      title: z.string(),
      subtitle: z.string(),
      published: z.date(),
      tags: z.array(z.string())
    })
});

export const collections = { blog };
