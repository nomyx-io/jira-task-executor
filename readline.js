const readline = require('readline');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const executeBashCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`);
                return;
            }
            if (stderr) {
                reject(`Warning: Command completed with stderr:\n${stderr}\nStdout: ${stdout}`);
                return;
            }
            resolve(stdout);
        });
    });
};

const createFile = async (filePath, content) => {
    try {
        await fs.writeFile(filePath, content);
        console.log(`File created successfully: ${filePath}`);
        return `File created successfully: ${filePath}`;
    } catch (error) {
        console.error(`Error creating file: ${error.message}`);
        throw `Error creating file: ${error.message}`;
    }
};

const createFolder = async (folderPath) => {
    try {
        await fs.mkdir(folderPath, { recursive: true });
        console.log(`Folder created successfully: ${folderPath}`);
        return `Folder created successfully: ${folderPath}`;
    } catch (error) {
        console.error(`Error creating folder: ${error.message}`);
        throw `Error creating folder: ${error.message}`;
    }
};

const listDirectory = async (dirPath = '.') => {
    try {
        const items = await fs.readdir(dirPath);
        const itemDetails = await Promise.all(items.map(async (item) => {
            const fullPath = path.join(dirPath, item);
            const stats = await fs.stat(fullPath);
            return `${item}${stats.isDirectory() ? '/' : ''}`;
        }));
        return itemDetails.join('\n');
    } catch (error) {
        console.error(`Error listing directory: ${error.message}`);
        throw `Error listing directory: ${error.message}`;
    }
};

const replace = (template, request) => {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return request[key] || match;
    });
};

const callOpenAI = async (messages, payload) => {
    const buildMsg = (role, content) => ({
        role,
        content: JSON.stringify({
            system: replace(content, payload.request),
            options: ["JSON_OUTPUT_ONLY", "DISABLE_COMMENTARY", "DISABLE_CODEBLOCKS"],
            response_format: payload.jsonResponseFormat
        })
    });

    const request = {
        messages: [
            buildMsg("system", payload.system),
            ...messages,
            buildMsg("user", payload.user)
        ],
        temperature: payload.temperature,
        top_p: payload.top_p,
        max_tokens: payload.max_tokens
    };

    try {
        const response = await axios.post(
            'https://nomyxazureopenai.openai.azure.com/openai/deployments/gpt4me/chat/completions?api-version=2024-02-15-preview',
            request,
            { headers: { 'Content-Type': 'application/json', 'api-key': '8af008edcb364f3e9e49861629d60ffe' } }
        );

        let result = response.data.choices[0].message.content;
        console.log('Raw AI response:', result);
        try {
            result = JSON.parse(result);
        } catch (e) {
            console.log('Failed to parse JSON, using raw response');
        }

        return [...messages, { role: 'assistant', content: result.response || result }];
    } catch (error) {
        console.error('Error calling OpenAI:', error.message);
        throw error;
    }
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let messages = [];

const payload = {
    system: `You are a helpful AI assistant with the ability to execute Bash commands and perform file system operations. You can create files, create folders, and list directory contents. When asked to perform these operations, use the following formats:

    - To create a file: !createFile <filePath> <fileContent>
    - To create a folder: !createFolder <folderPath>
    - To list directory contents: !listDir <directoryPath>

    Analyze any errors and suggest fixes. If asked to run a command or perform an operation, respond with the output or your analysis and suggested fix for any errors. {{custom_instruction}}`,
    user: "",
    temperature: 0.7,
    top_p: 1,
    max_tokens: 300,
    jsonResponseFormat: { type: "json_object" },
    request: {}
};

console.log("Welcome to the OpenAI CLI Interface with file system operations!");
console.log("Type your messages and press Enter to send them to the AI.");
console.log("Special commands:");
console.log("  !bash <command> - Execute a Bash command");
console.log("  !createFile <filePath> <fileContent> - Create a new file");
console.log("  !createFolder <folderPath> - Create a new folder");
console.log("  !listDir <directoryPath> - List directory contents");
console.log("Type 'exit' to quit the program.");

const handleSpecialCommands = async (input) => {
    console.log('Handling special command:', input);
    if (input.startsWith('!bash ')) {
        const command = input.slice(6);
        return await handleBashCommand(command);
    } else if (input.startsWith('!createFile ')) {
        const [, filePath, ...contentParts] = input.split(' ');
        const content = contentParts.join(' ');
        return await createFile(filePath, content);
    } else if (input.startsWith('!createFolder ')) {
        const folderPath = input.slice(14);
        return await createFolder(folderPath);
    } else if (input.startsWith('!listDir ')) {
        const dirPath = input.slice(9) || '.';
        return await listDirectory(dirPath);
    }
    return null;
};

const handleBashCommand = async (command) => {
    try {
        const output = await executeBashCommand(command);
        console.log('Bash output:', output);
        return `The Bash command "${command}" executed successfully. Output:\n${output}`;
    } catch (error) {
        console.error('Bash error:', error);
        return `The Bash command "${command}" failed with the following error:\n${error}\nPlease analyze this error, suggest a fix, and provide the corrected command.`;
    }
};

const promptUser = async () => {
    try {
        const input = await new Promise(resolve => rl.question('You: ', resolve));

        if (input.toLowerCase() === 'exit') {
            rl.close();
            return;
        }

        const specialCommandOutput = await handleSpecialCommands(input);
        if (specialCommandOutput) {
            console.log('Special command output:', specialCommandOutput);
            payload.user = specialCommandOutput;
        } else {
            payload.user = input;
        }
        
        messages = await callOpenAI(messages, payload);
        const response = messages[messages.length - 1].content;
        console.log('AI response:', response);

        if (typeof response === 'string') {
            console.log('AI:', response);
            const suggestedCommand = response.match(/!(?:bash|createFile|createFolder|listDir)\s+[^\n]+/);
            if (suggestedCommand) {
                const execute = await new Promise(resolve => 
                    rl.question(`Would you like to execute the suggested command: "${suggestedCommand[0]}"? (yes/no) `, resolve)
                );
                if (execute.toLowerCase() === 'yes') {
                    const output = await handleSpecialCommands(suggestedCommand[0]);
                    payload.user = output || "Command executed successfully.";
                    messages = await callOpenAI(messages, payload);
                    console.log('AI:', messages[messages.length - 1].content);
                }
            }
        } else {
            console.log('AI response is not a string. Here\'s what I received:', response);
        }
    } catch (error) {
        console.error('An error occurred:', error.message);
        console.log('The system has recovered. You can continue using the interface.');
    }

    promptUser();
};

promptUser();

rl.on('close', () => {
    console.log('Thank you for using the OpenAI CLI Interface with file system operations. Goodbye!');
    process.exit(0);
});