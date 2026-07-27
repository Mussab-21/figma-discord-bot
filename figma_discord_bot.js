const fs = require('fs');
const path = require('path');

// --- Configuration ---
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// Files to track (Add your Figma File Key here)
// Example URL: https://www.figma.com/file/abc12345/App-Design -> File Key is 'abc12345'
const TRACKED_FILES = [
    '2Ioz1ZsIAHpm9JwkekBttL'
];

// Developer Mapping
const ASSIGNEES = {
    // 'YOUR_FILE_KEY_HERE': '<@DISCORD_USER_ID>' // Replace with actual user ID
    'default': '@here' // Fallback
};

// State file to remember what we've already notified about
const STATE_FILE = path.join(__dirname, 'state.json');

// --- Helper Functions ---
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return {};
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Find all nodes in the Figma tree that are "READY_FOR_DEV"
function findReadyForDevNodes(node, results = []) {
    if (node.devStatus && node.devStatus.type === 'READY_FOR_DEV') {
        results.push(node);
    }
    if (node.children) {
        node.children.forEach(child => findReadyForDevNodes(child, results));
    }
    return results;
}

// --- Main Process ---
async function run() {
    console.log(`[${new Date().toISOString()}] Starting Figma check...`);
    
    if (TRACKED_FILES.length === 0) {
        console.log("No Figma files configured to track. Please add a File Key to TRACKED_FILES in the script.");
        return;
    }

    const state = loadState();

    for (const fileKey of TRACKED_FILES) {
        try {
            console.log(`Checking file: ${fileKey}`);
            
            // 1. Get file data
            const fileRes = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
                headers: { 'X-Figma-Token': FIGMA_TOKEN }
            });
            
            if (!fileRes.ok) {
                console.error(`Failed to fetch file ${fileKey}: ${fileRes.statusText}`);
                continue;
            }
            
            const fileData = await fileRes.json();
            const fileName = fileData.name;
            
            // 2. Find nodes ready for dev
            const readyNodes = findReadyForDevNodes(fileData.document);
            const readyNodeIds = readyNodes.map(n => n.id);
            
            // Remove any nodes from state that are no longer marked "Ready for Dev"
            // This allows designers to toggle the status off and on to trigger a new message!
            if (state[fileKey]) {
                state[fileKey] = state[fileKey].filter(id => readyNodeIds.includes(id));
            } else {
                state[fileKey] = [];
            }
            
            let stateChanged = false;
            
            for (const node of readyNodes) {
                // If we haven't notified about this node yet
                if (!state[fileKey].includes(node.id)) {
                    console.log(`Found NEW ready for dev node: ${node.name} (${node.id})`);
                    
                    // 3. Get image preview
                    const imgRes = await fetch(`https://api.figma.com/v1/images/${fileKey}?ids=${node.id}&format=png&scale=2`, {
                        headers: { 'X-Figma-Token': FIGMA_TOKEN }
                    });
                    
                    let imageUrl = null;
                    if (imgRes.ok) {
                        const imgData = await imgRes.json();
                        imageUrl = imgData.images[node.id];
                    }
                    
                    // 4. Build Discord Message
                    const description = node.devStatus.description || "No specific notes provided by designer.";
                    const figmaUrl = `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(node.id)}`;
                    const assignee = ASSIGNEES[fileKey] || ASSIGNEES['default'];
                    
                    const payload = {
                        content: `${assignee} A screen is ready for dev in **${fileName}**!`,
                        embeds: [{
                            title: `Ready for Dev: ${node.name}`,
                            description: description,
                            url: figmaUrl,
                            color: 1127128, // Figma brand blue
                            timestamp: new Date().toISOString()
                        }]
                    };
                    
                    if (imageUrl) {
                        payload.embeds[0].image = { url: imageUrl };
                    }
                    
                    // 5. Send to Discord
                    const discordRes = await fetch(DISCORD_WEBHOOK, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if (discordRes.ok) {
                        console.log(`Successfully notified Discord for node ${node.id}`);
                        // Mark as notified in state
                        state[fileKey].push(node.id);
                    } else {
                        console.error(`Failed to notify Discord: ${discordRes.statusText}`);
                    }
                }
            }
            
            // Always save state at the end of processing the file
            // so if a node was removed from 'Ready for Dev', it gets forgotten!
            saveState(state);
            
        } catch (error) {
            console.error(`Error processing file ${fileKey}:`, error);
        }
    }
    
    console.log(`[${new Date().toISOString()}] Finished check.`);
}

run();
