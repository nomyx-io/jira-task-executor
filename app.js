require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const JiraApi = require('jira-client');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Initialize JIRA client
const jira = new JiraApi({
  protocol: 'https',
  host: process.env.JIRA_HOST,
  username: process.env.JIRA_USERNAME,
  password: process.env.JIRA_API_TOKEN,
  apiVersion: '2',
  strictSSL: true
});

app.post('/generate-markdown', async (req, res) => {
    try {
      const markdownContent = await generateMarkdownFromConversation();
      res.json({ markdown: markdownContent });
    } catch (error) {
      console.error('Error generating markdown:', error);
      res.status(500).json({ error: 'Failed to generate markdown' });
    }
  });

// Conversation history
let conversationHistory = [];

// Serve static HTML for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/converse', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const response = await conversationWithLLM(message);
    const isComplete = response.toLowerCase().includes("thank you for providing all the necessary information.");
    res.json({ response, isComplete });
  } catch (error) {
    console.error('Error in conversation:', error);
    res.status(500).json({ error: 'Failed to process conversation' });
  }
});

async function conversationWithLLM(message) {
  try {
    conversationHistory.push({ role: "user", content: message });
    
    const response = await axios.post(
      `${process.env.AZURE_OPENAI_ENDPOINT}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=${process.env.AZURE_OPENAI_API_VERSION}`,
      {
        messages: [
          { role: "system", content: "You are a project manager gathering requirements for a new project. Ask relevant questions to understand the project scope, objectives, and specific requirements. Cover topics such as project goals, timeline, team size, main features, and potential challenges. After gathering sufficient information, inform the user that you have enough details to create the project structure by saying 'Thank you for providing all the necessary information.'" },
          ...conversationHistory
        ],
        max_tokens: 300
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.AZURE_OPENAI_API_KEY
        }
      }
    );

    if (!response.data.choices || response.data.choices.length === 0) {
      throw new Error('No response from Azure OpenAI API');
    }

    const aiMessage = response.data.choices[0].message.content;
    conversationHistory.push({ role: "assistant", content: aiMessage });
    return aiMessage;
  } catch (error) {
    console.error('Error in conversationWithLLM:', error);
    throw error;
  }
}

app.post('/create-project', async (req, res) => {
    console.log('Received request to create project');
    try {
      console.log('Generating markdown from conversation');
      const markdownContent = await generateMarkdownFromConversation();
      console.log('Generated markdown:', markdownContent);
  
      console.log('Processing markdown with LLM');
      const projectStructure = await processMarkdownWithLLM(markdownContent);
      console.log('Processed project structure:', JSON.stringify(projectStructure, null, 2));
  
      console.log('Creating JIRA project');
      const jiraProject = await createJiraProject(projectStructure);
      console.log('JIRA project created:', JSON.stringify(jiraProject, null, 2));
  
      res.json({ message: 'Project created successfully', project: jiraProject });
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(500).json({ error: 'Failed to create project', details: error.message });
    }
  });
  
  async function generateMarkdownFromConversation() {
    console.log('Starting markdown generation');
    let markdown = "# Project Requirements\n\n";
    
    for (const message of conversationHistory) {
      if (message.role === "user") {
        markdown += `## User Input\n${message.content}\n\n`;
      } else if (message.role === "assistant") {
        markdown += `## AI Response\n${message.content}\n\n`;
      }
    }
  
    console.log('Writing markdown to file');
    await fs.writeFile('project_requirements.md', markdown);
    console.log('Markdown file written successfully');
    return markdown;
  }
  
  async function processMarkdownWithLLM(markdownContent) {
    console.log('Processing markdown with LLM');
    try {
      const response = await axios.post(
        `${process.env.AZURE_OPENAI_ENDPOINT}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=${process.env.AZURE_OPENAI_API_VERSION}`,
        {
          messages: [
            { role: "system", content: "You are a project management assistant. Analyze the given markdown content and create a structured project plan suitable for JIRA. Include a project key, name, description, and a list of epics. Each epic should have a name, description, and a list of stories. Each story should have a name, description, and a list of subtasks. Provide the output as a JSON object." },
            { role: "user", content: markdownContent }
          ],
          max_tokens: 1500
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': process.env.AZURE_OPENAI_API_KEY
          }
        }
      );
  
      console.log('Received response from LLM');
      if (!response.data.choices || response.data.choices.length === 0) {
        throw new Error('No response from Azure OpenAI API');
      }
  
      const content = response.data.choices[0].message.content;
      console.log('Raw LLM response:', content);
  
      let result;
      try {
        result = JSON.parse(content);
      } catch (parseError) {
        console.log('Failed to parse LLM response as JSON. Attempting to extract structured data from markdown.');
        result = extractStructuredDataFromMarkdown(content);
      }
  
      console.log('Processed LLM response:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('Error in processMarkdownWithLLM:', error);
      throw error;
    }
  }
  
  function extractStructuredDataFromMarkdown(markdown) {
    const lines = markdown.split('\n');
    const project = {
      key: '',
      name: '',
      description: '',
      epics: []
    };
  
    let currentEpic = null;
    let currentStory = null;
  
    for (const line of lines) {
      if (line.startsWith('# ')) {
        project.name = line.substring(2).trim();
      } else if (line.startsWith('## ')) {
        if (currentEpic) {
          project.epics.push(currentEpic);
        }
        currentEpic = { name: line.substring(3).trim(), description: '', stories: [] };
      } else if (line.startsWith('### ')) {
        if (currentStory) {
          currentEpic.stories.push(currentStory);
        }
        currentStory = { name: line.substring(4).trim(), description: '', subtasks: [] };
      } else if (line.startsWith('- ')) {
        if (currentStory) {
          currentStory.subtasks.push({ name: line.substring(2).trim(), description: '' });
        }
      } else if (line.trim() !== '') {
        if (currentStory) {
          currentStory.description += line.trim() + ' ';
        } else if (currentEpic) {
          currentEpic.description += line.trim() + ' ';
        } else {
          project.description += line.trim() + ' ';
        }
      }
    }
  
    if (currentStory) {
      currentEpic.stories.push(currentStory);
    }
    if (currentEpic) {
      project.epics.push(currentEpic);
    }
  
    // Generate a project key if not provided
    if (!project.key) {
      project.key = project.name.split(' ').map(word => word[0].toUpperCase()).join('').substring(0, 4);
    }
  
    return project;
  }
  
  async function createJiraProject(projectStructure) {
    console.log('Starting JIRA project creation');
    try {
      // Create the project
      console.log('Creating main project');
      const project = await jira.createProject({
        key: projectStructure.key,
        name: projectStructure.name,
        projectTypeKey: 'software',
        description: projectStructure.description
      });
  
      console.log(`Created project: ${project.name} (${project.key})`);
  
      // Create epics
      for (const epic of projectStructure.epics) {
        console.log(`Creating epic: ${epic.name}`);
        const createdEpic = await jira.addNewIssue({
          fields: {
            project: { key: project.key },
            summary: epic.name,
            description: epic.description,
            issuetype: { name: 'Epic' }
          }
        });
  
        console.log(`Created epic: ${epic.name} (${createdEpic.key})`);
  
        // Create stories for each epic
        for (const story of epic.stories) {
          console.log(`Creating story: ${story.name}`);
          const createdStory = await jira.addNewIssue({
            fields: {
              project: { key: project.key },
              summary: story.name,
              description: story.description,
              issuetype: { name: 'Story' },
              parent: { key: createdEpic.key }
            }
          });
  
          console.log(`Created story: ${story.name} (${createdStory.key})`);
  
          // Create subtasks for each story
          for (const subtask of story.subtasks) {
            console.log(`Creating subtask: ${subtask.name}`);
            const createdSubtask = await jira.addNewIssue({
              fields: {
                project: { key: project.key },
                summary: subtask.name,
                description: subtask.description,
                issuetype: { name: 'Sub-task' },
                parent: { key: createdStory.key }
              }
            });
  
            console.log(`Created subtask: ${subtask.name} (${createdSubtask.key})`);
          }
        }
      }
  
      console.log('JIRA project creation completed successfully');
      return { 
        id: project.id, 
        key: project.key, 
        name: project.name,
        self: project.self 
      };
    } catch (error) {
      console.error('Error creating JIRA project:', error);
      throw new Error(`Failed to create JIRA project: ${error.message}`);
    }
  }

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});