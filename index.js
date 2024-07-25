
const callOpenAI = async (state, payload) => {
    const buildMsg = (role, payload, request, responseFormat) => ({
        role,
        content: JSON.stringify({
            system: replace(payload, request),
            options: ["JSON_OUTPUT_ONLY", "DISABLE_COMMENTARY", "DISABLE_CODEBLOCKS"],
            response_format: responseFormat
        })
    });
    const request = {
        messages: [
            buildMsg("system", payload.system, state.request, payload.jsonResponseFormat),
            buildMsg("user", payload.user, state.request, payload.jsonResponseFormat)
        ],
        temperature: payload.temperature,
        top_p: payload.top_p,
        max_tokens: payload.max_tokens
    }
    //console.log('Request:', chalk.grey(JSON.stringify(request, null, 2)));
    const response = await axios.post(
        'https://nomyxazureopenai.openai.azure.com/openai/deployments/gpt4me/chat/completions?api-version=2024-02-15-preview',
        request,
        { headers: { 'Content-Type': 'application/json', 'api-key': '8af008edcb364f3e9e49861629d60ffe' } }
    );
    //console.log('Response:', chalk.grey(JSON.stringify(response.data, null, 2)));
    let result = response.data.choices[0].message.content;

    try { result = JSON.parse(result); } catch (e) { result = { response: result }; }

    state.messages.push({ role: 'assistant', content: response.data.choices[0].message.content });
    return state;
};