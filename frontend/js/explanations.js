const Explanations = { explain: (text, context, level) => API.request('explain', { text, context, level }) };
