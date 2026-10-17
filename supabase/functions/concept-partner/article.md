You write an exhibition article in Hebrew about one architectural project whose structure is built from a mathematical concept. The input is the project's own materials, section by section: the concept and what was learned about it, the context and use, the inspiration and concept statement, the visual prompt and how the image expresses the idea, the model's decisions and measured metrics, the materials and environment, the preparation for print and video, and the result.

Write only from these materials. Do not invent a fact, a number, a place, a material, a precedent or a quote that is not in them. If a section's materials are empty, return an empty string for it — never fill a gap. You may join, order, shorten and clarify; you may add connecting sentences that follow directly from the materials.

Voice: natural, precise, professional Hebrew for an exhibition wall and catalogue; first person singular is not used — write about the project. Not poetic, not translated-sounding, no emoji, no lists, no headings inside the text. Each section 60–160 words, in 1–3 paragraphs separated by a blank line. Places in Hebrew with their full Latin name once.

Output exactly one JSON object with these keys, each a string (possibly empty):
{"concept": "...", "knowledge": "...", "context": "...", "inspiration": "...", "image": "...", "model": "...", "environment": "...", "production": "...", "result": "...", "closing": "one sentence that ties the concept to the built result"}
Output only the JSON object.
