require("dotenv").config();
require('v8').setFlagsFromString('--max-old-space-size=6096');
const { Routes } = require('discord-api-types/v10');
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const { Client: SSHClient } = require('ssh2');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
const fsPromises = fs.promises;
const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const languages = require('./languages.json');

const token = process.env.DISCORD_BOT_TOKEN;
const clientid = process.env.DISCORD_CLIENT_ID;
const accessedRole = process.env.ACCESSED_ROLE;
const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
const successChannelId = process.env.SUCCESS_CHANNEL_ID;
const errorChannelId = process.env.ERROR_CHANNEL_ID;
const helpChannelId = process.env.HELP_CHANNEL_ID;

if (!token || !clientid || !accessedRole || !announcementChannelId || !successChannelId || !errorChannelId || !helpChannelId) {
    throw new Error("Missing DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, ACCESSED_ROLE, ANNOUNCEMENT_CHANNEL_ID, SUCCESS_CHANNEL_ID, or ERROR_CHANNEL_ID or HELP_CHANNELID in .env file");
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    ws: { properties: { browser: "Discord iOS" } }
});

let statistics = {
    installations: 0,
    totalInstallations: 0,
    mysqlInstallations: 0,
    nonMysqlInstallations: 0,
    errors: {}
};

const statsFilePath = path.join(__dirname, 'statistics.json');
if (fs.existsSync(statsFilePath)) {
    const readStream = fs.createReadStream(statsFilePath, { encoding: 'utf8' });
    let data = '';
    readStream.on('data', chunk => {
        data += chunk;
    });
    readStream.on('end', () => {
        statistics = JSON.parse(data);
    });
}

async function saveStatistics() {
    try {
        const writeStream = fs.createWriteStream(statsFilePath);
        writeStream.write(JSON.stringify(statistics, null, 2));
        writeStream.end();
    } catch (error) {
        console.error('Error saving statistics:', error);
    }
}

async function chunkOutput(output, maxLength = 1900) {
    const chunks = [];
    let currentChunk = '';

    for (const line of output.split('\n')) {
        if (currentChunk.length + line.length + 1 > maxLength) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

function sendErrorEmbed(interaction, customId, lang, err, errorChannelId) {
    const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Installation Error')
        .setDescription(`An error occurred during the installation process (ID: **__${customId}__**)`)
        .addFields([
            {
                name: 'IP Address',
                value: truncateString(`||${interaction.options.getString("ip")}||`),
                inline: true
            },
            {
                name: 'Port',
                value: truncateString(`||${interaction.options.getString("port")}||`),
                inline: true
            },
            {
                name: 'Username',
                value: truncateString(`||${interaction.options.getString("user")}||`),
                inline: true
            },
            {
                name: 'Error',
                value: truncateString(err.message || 'Unknown error')
            }
        ])
        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    const errorChannel = client.channels.cache.get(errorChannelId);
    if (errorChannel) {
        errorChannel.send({ embeds: [errorEmbed] });
    }

    if (!statistics.errors) {
        statistics.errors = {};
    }

    statistics.errors[err.message] = (statistics.errors[err.message] || 0) + 1;
    saveStatistics();

    if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: truncateString(`SSH Error: ${err.message} (ID: **__${customId}__**)`), flags: 64 });
    } else if (interaction.deferred) {
        return interaction.editReply({ content: truncateString(`SSH Error: ${err.message} (ID: **__${customId}__**)`), flags: 64 });
    } else {
        return interaction.followUp({ content: truncateString(`SSH Error: ${err.message} (ID: **__${customId}__**)`), flags: 64 });
    }
}

function truncateString(str, length = 1000) {
    return str && str.length > length ? str.substring(0, length - 3) + '...' : (str || 'N/A');
}

function setWaitingStatus() {
    client.user.setActivity('Waiting to Install a Server', { type: ActivityType.Watching });
}

function parseOutput(output) {
    const urlMatch = output.match(/Webinterface: \x1B\[0m(http:\/\/[^\s]+)/);
    const pinMatch = output.match(/Pin: \x1B\[0m(\d+)/);
    const pathMatch = output.match(/Server-Data Path: \x1B\[0m([^\n]+)/);

    return {
        url: urlMatch ? urlMatch[1] : 'Not found',
        pin: pinMatch ? pinMatch[1] : 'Not found',
        path: pathMatch ? pathMatch[1] : 'Not found'
    };
}

function cleanOutput(output) {
    return output.replace(/\x1B\[[0-9;]*m/g, '').replace(/\x1B\].*?\x07/g, '').replace(/[^\x00-\x7F]/g, '');
}

function extractRelevantOutput(output, mysqlOption) {
    const startIndex = output.indexOf('TxAdmin was started successfully');
    if (startIndex === -1) return output;
    let relevantOutput = output.substring(startIndex).trim();

    const mysqlStartIndex = output.indexOf('FiveM MySQL-Data');
    if (mysqlStartIndex !== -1) {
        const mysqlEndIndex = output.indexOf('sleep 1', mysqlStartIndex);
        const mysqlData = output.substring(mysqlStartIndex, mysqlEndIndex).trim();
        relevantOutput += `\n\n${mysqlData}`;
    }

    return relevantOutput;
}

async function generateScreenshot(output) {
    let browser = null;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.setContent(`
            <html>
                <body style="background: #141313; color: white; font-family: monospace; padding: 20px;">
                    <h1 style="text-align: center;">Server Installation Output</h1>
                    <pre>${output || "No output"}</pre>
                    <footer style="margin-top: 20px; text-align: center; font-size: 14px;">
                        Made by Lucentix & CuzImStupi4 with ❤️
                    </footer>
                </body>
            </html>
        `);

        const screenshotPath = path.join(os.tmpdir(), `output-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath });
        await page.close();
        return screenshotPath;
    } catch (error) {
        console.error('Screenshot generation failed:', error);
        return null;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Failed to close browser:', closeError);
            }
        }
    }
}

async function sendDM(user, content, embed, files) {
    try {
        await user.send({
            content: content,
            embeds: [embed],
            files: files
        });
        console.log('Sent DM to user');
    } catch (dmError) {
        console.error("Failed to send DM:", dmError);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName("install")
        .setDescription("Installs a FiveM server")
        .addStringOption(option =>
            option.setName("language")
                .setDescription("Select language")
                .setRequired(true)
                .addChoices(
                    { name: 'English', value: 'en' },
                    { name: 'Deutsch', value: 'de' }
                )
        )
        .addStringOption(option =>
            option.setName("ip")
                .setDescription("The IP of the server")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("port")
                .setDescription("The port of the server (usually 22)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("user")
                .setDescription("The username of the server (usually root)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("password")
                .setDescription("The password of the server")
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Displays installation statistics")
        .addStringOption(option =>
            option.setName("language")
                .setDescription("Select language")
                .setRequired(false)
                .addChoices(
                    { name: 'English', value: 'en' },
                    { name: 'Deutsch', value: 'de' }
                )
        ),
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Displays available commands and their descriptions")
        .addStringOption(option =>
            option.setName("language")
                .setDescription("Select language")
                .setRequired(false)
                .addChoices(
                    { name: 'English', value: 'en' },
                    { name: 'Deutsch', value: 'de' }
                )
        )
];

const rest = new REST({ version: '10' }).setToken(token);
(async () => {
    try {
        console.log("Started refreshing application (/) commands");
        await rest.put(Routes.applicationCommands(clientid), { body: commands });
        console.log("Successfully reloaded application (/) commands");
    } catch (error) {
        console.error("Error refreshing commands:", error);
    }
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    setWaitingStatus();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    console.log(`Received command: ${interaction.commandName}`);

    if (interaction.commandName === "install") {
        const language = interaction.options.getString("language");
        const lang = languages[language] || languages.en;

        if (!interaction.member.roles.cache.has(accessedRole)) {
            console.log('User does not have the required role');
            return interaction.reply({ content: lang.noPermission, flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });
        console.log('Deferred reply for install command');

        const ip = interaction.options.getString("ip");
        const port = interaction.options.getString("port");
        const user = interaction.options.getString("user");
        const password = interaction.options.getString("password");

        console.log(`IP: ${ip}, Port: ${port}, User: ${user}`);

        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const portRegex = /^([0-9]{1,5})$/;

        if (!ipRegex.test(ip)) {
            console.log('Invalid IP address');
            return interaction.editReply({ content: lang.invalidIp, flags: 64 });
        }

        if (!portRegex.test(port) || parseInt(port) > 65535) {
            console.log('Invalid port');
            return interaction.editReply({ content: lang.invalidPort, flags: 64 });
        }

        const customId = crypto.randomBytes(3).toString('hex').slice(0, 5);
        console.log(`Generated custom ID: ${customId}`);

        const ssh = new SSHClient();
        let output = '';
        let lastMessage = '';

        client.user.setActivity(`Installing for ${interaction.user.tag}...`, { type: ActivityType.Playing });

        ssh.on('ready', async () => {
            console.log('SSH connection ready');
            const mysqlRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('mysql_yes')
                        .setLabel(lang.mysqlYes)
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('mysql_no')
                        .setLabel(lang.mysqlNo)
                        .setStyle(ButtonStyle.Danger)
                );
            try {
                await interaction.editReply({ content: lang.installPrompt, components: [mysqlRow], flags: 64 });
                console.log('Prompted user for MySQL option');

                const filter = i => i.user.id === interaction.user.id;
                const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });
                collector.on('collect', async i => {
                    const mysqlOption = i.customId === 'mysql_yes' ? 'yes' : 'no';
                    await i.update({ content: `${lang.mysqlSelected} ${mysqlOption}`, components: [], flags: 64 });
                    console.log(`User selected MySQL option: ${mysqlOption}`);

                    const command = mysqlOption === "yes"
                        ? "bash <(curl -s https://raw.githubusercontent.com/Twe3x/fivem-installer/main/setup.sh) --non-interactive --kill-port -c --delete-dir -p --security  --generate_password --db_user fivem"
                        : "bash <(curl -s https://raw.githubusercontent.com/Twe3x/fivem-installer/main/setup.sh) --non-interactive --kill-port -c --delete-dir";

                    console.log(`Executing command: ${command}`);
                    try {
                        ssh.exec(command, (err, stream) => {
                            if (err) {
                                console.error('SSH exec error:', err);
                                setWaitingStatus();
                                return sendErrorEmbed(interaction, customId, lang, err, errorChannelId);
                            }

                            stream.on('data', async data => {
                                const newOutput = data.toString();
                                output += newOutput;
                                console.log(`Received SSH output: ${newOutput}`);

                                const cleanedOutput = cleanOutput(output);
                                const chunks = await chunkOutput(cleanedOutput);
                                if (chunks.length > 0) {
                                    try {
                                        const lastChunk = chunks[chunks.length - 1];
                                        if (lastChunk !== lastMessage) {
                                            await interaction.editReply({
                                                content: lastChunk,
                                                components: [],
                                                flags: 64
                                            });
                                            lastMessage = lastChunk;
                                        }
                                    } catch (error) {
                                        console.error('Error updating messages:', error);
                                    }
                                }
                            });

                            stream.on('close', async () => {
                                console.log('SSH stream closed');
                                ssh.end();
                                const tempDir = os.tmpdir();
                                const outputFilePath = path.join(tempDir, `output-${Date.now()}.txt`);

                                try {
                                    const cleanedOutput = cleanOutput(output);
                                    const relevantOutput = extractRelevantOutput(cleanedOutput, mysqlOption);
                                    const writeStream = fs.createWriteStream(outputFilePath);
                                    writeStream.write(relevantOutput);
                                    writeStream.end();
                                    console.log(`Saved output to file: ${outputFilePath}`);
                                    const screenshotPath = await generateScreenshot(relevantOutput);
                                    console.log(`Generated screenshot: ${screenshotPath}`);

                                    const files = [];
                                    if (await fsPromises.access(outputFilePath).then(() => true).catch(() => false)) {
                                        files.push({ attachment: outputFilePath, name: "output.txt" });
                                    }
                                    if (screenshotPath && await fsPromises.access(screenshotPath).then(() => true).catch(() => false)) {
                                        files.push({ attachment: screenshotPath, name: "output.png" });
                                    }

                                    const { url, pin, path: serverPath } = parseOutput(relevantOutput);
                                    console.log(`Parsed output - URL: ${url}, PIN: ${pin}, Path: ${serverPath}`);

                                    const successEmbed = new EmbedBuilder()
                                        .setColor('#00FF00')
                                        .setTitle('Installation Success')
                                        .setDescription(`A new FiveM server has been successfully installed!`)
                                        .addFields([
                                            { name: 'ID', value: String(`**__${customId}__**`), inline: true },
                                            { name: 'IP Address', value: String(`||${ip}||`), inline: true },
                                            { name: 'Port', value: String(`||${port}||`), inline: true },
                                            { name: 'Username', value: String(`||${user}||`), inline: true },
                                            { name: 'MySQL', value: String(mysqlOption === "yes" ? "Yes" : "No"), inline: true }
                                        ])
                                        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                        .setTimestamp();

                                    await sendDM(interaction.user, `${lang.processFinished} (ID: **__${customId}__**)`, successEmbed, files);

                                    setTimeout(async () => {
                                        try {
                                            if (await fsPromises.access(outputFilePath).then(() => true).catch(() => false)) await fsPromises.unlink(outputFilePath);
                                            if (screenshotPath && await fsPromises.access(screenshotPath).then(() => true).catch(() => false)) await fsPromises.unlink(screenshotPath);
                                            console.log('Cleaned up temporary files');
                                        } catch (error) {
                                            console.error('Cleanup error:', error);
                                        }
                                    }, 1000);

                                    const embed = new EmbedBuilder()
                                        .setColor('#00FF00')
                                        .setTitle(lang.installationSuccess)
                                        .setDescription(`Installation completed successfully (ID: **__${customId}__**).`)
                                        .addFields(
                                            { name: 'Output', value: `\`\`\`${relevantOutput || "No output"}\`\`\`` }
                                        )
                                        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                        .setTimestamp();

                                    await interaction.followUp({
                                        content: `${lang.processFinished} (ID: **__${customId}__**)`,
                                        embeds: [embed],
                                        files: [
                                            { attachment: screenshotPath, name: "output.png" },
                                            { attachment: outputFilePath, name: "output.txt" }
                                        ],
                                        flags: 64
                                    });

                                    const publicEmbed = new EmbedBuilder()
                                        .setColor('#00FF00')
                                        .setTitle('Server Installation')
                                        .setDescription(`A new FiveM server has been successfully installed by <@${interaction.user.id}>!`)
                                        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                        .setTimestamp();

                                    const announcementChannel = client.channels.cache.get(announcementChannelId);
                                    if (announcementChannel) {
                                        announcementChannel.send({ embeds: [publicEmbed] });
                                        console.log('Sent announcement to channel');
                                    }

                                    const successChannel = client.channels.cache.get(successChannelId);
                                    if (successChannel) {
                                        successChannel.send({ embeds: [successEmbed] });
                                        console.log('Sent success message to channel');
                                    }

                                    statistics.totalInstallations += 1;
                                    if (mysqlOption === "yes") {
                                        statistics.mysqlInstallations += 1;
                                    } else {
                                        statistics.nonMysqlInstallations += 1;
                                    }
                                    await saveStatistics();
                                    console.log('Updated statistics');

                                    setWaitingStatus();
                                } catch (error) {
                                    console.error('Error during installation completion:', error);
                                    setWaitingStatus();
                                    return sendErrorEmbed(interaction, customId, lang, error, errorChannelId);
                                }
                            });
                        });
                        collector.on('end', async collected => {
                            if (!collected.size) {
                                console.log('No response from user for MySQL option');
                                await interaction.editReply({ content: `${lang.noResponse} (ID: **__${customId}__**)`, components: [], flags: 64 });
                                setWaitingStatus();
                            }
                        });

                    } catch (error) {
                        console.error('Error during SSH command execution:', error);
                        setWaitingStatus();
                        return sendErrorEmbed(interaction, customId, lang, error, errorChannelId);
                    }
                });
            } catch (error) {
                console.error('Error during SSH connection setup:', error);
                setWaitingStatus();
                return sendErrorEmbed(interaction, customId, lang, error, errorChannelId);
            }
        });

        ssh.on('error', (err) => {
            console.error('SSH connection error:', err);
            setWaitingStatus();
            return sendErrorEmbed(interaction, customId, lang, err, errorChannelId);
        });

        ssh.connect({ host: ip, port: parseInt(port), username: user, password: password });
        console.log('SSH connection initiated');
    } else if (interaction.commandName === "stats") {
        try {
            const statsEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Installation Statistics')
                .setDescription('Here are the current installation statistics:')
                .addFields([
                    { name: 'Total Installations', value: String(statistics.totalInstallations), inline: true },
                    { name: 'MySQL Installations', value: String(statistics.mysqlInstallations), inline: true },
                    { name: 'Non-MySQL Installations', value: String(statistics.nonMysqlInstallations), inline: true }
                ])
                .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await interaction.reply({ embeds: [statsEmbed], flags: 64 });
            console.log('Sent statistics embed');
        } catch (error) {
            console.error('Error handling stats command:', error);
            await interaction.reply({ content: 'An error occurred while fetching statistics.', flags: 64 });
        }
    } else if (interaction.commandName === "help") {
        try {
            const language = interaction.options.getString("language") || 'en';
            const lang = languages[language] || languages.en;

            const helpEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle(lang.helpTitle)
                .setDescription(lang.helpDescription)
                .addFields([
                    { name: '/install', value: lang.helpInstall },
                    { name: '/stats', value: lang.helpStats },
                    { name: '/help', value: lang.helpHelp }
                ])
                .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await interaction.reply({
                embeds: [helpEmbed],
                flags: 64
            });
            console.log('Sent help embed');
        } catch (error) {
            console.error('Error handling help command:', error);
            await interaction.reply({ content: 'An error occurred while fetching help information.', flags: 64 });
        }
    }
});

client.login(token);