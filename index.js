require("dotenv").config();
const { Routes } = require('discord-api-types/v10');
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const { Client: SSHClient } = require('ssh2');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
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
    totalInstallations: 0,
    mysqlInstallations: 0,
    nonMysqlInstallations: 0,
    errors: {}
};

const statsFilePath = path.join(__dirname, 'statistics.json');
if (fs.existsSync(statsFilePath)) {
    statistics = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
}

function saveStatistics() {
    fs.writeFileSync(statsFilePath, JSON.stringify(statistics, null, 2));
}

function chunkOutput(output, maxLength = 1900) {
    const chunks = [];
    let currentChunk = '';

    output.split('\n').forEach(line => {
        if (currentChunk.length + line.length + 1 > maxLength) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    });

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

    statistics.errors[err.message] = (statistics.errors[err.message] || 0) + 1;
    saveStatistics();

    if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: truncateString(`SSH Error: ${err.message} (ID: **__${customId}__**)`), ephemeral: true });
    } else if (interaction.deferred) {
        return interaction.editReply({ content: truncateString(`SSH Error: ${err.message} (ID: **__${customId}__**)`), ephemeral: true });
    } else {
        return interaction.followUp({ content: truncateString(`SSH Error: ${err.message} (ID: **__${customId}__**)`), ephemeral: true });
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

    if (interaction.commandName === "install") {
        const language = interaction.options.getString("language");
        const lang = languages[language] || languages.en;

        if (!interaction.member.roles.cache.has(accessedRole)) {
            return interaction.reply({ content: lang.noPermission, flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        const ip = interaction.options.getString("ip");
        const port = interaction.options.getString("port");
        const user = interaction.options.getString("user");
        const password = interaction.options.getString("password");

        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const portRegex = /^([0-9]{1,5})$/;

        if (!ipRegex.test(ip)) {
            return interaction.editReply({ content: lang.invalidIp, flags: 64 });
        }

        if (!portRegex.test(port) || parseInt(port) > 65535) {
            return interaction.editReply({ content: lang.invalidPort, flags: 64 });
        }

        const customId = crypto.randomBytes(3).toString('hex').slice(0, 5);

        const ssh = new SSHClient();
        let output = '';

        client.user.setActivity(`Installing for ${interaction.user.tag}...`, { type: ActivityType.Playing });

        ssh.on('ready', async () => {
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
                await interaction.editReply({ content: lang.installPrompt, components: [mysqlRow] });

                const filter = i => i.user.id === interaction.user.id;
                const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });
                collector.on('collect', async i => {
                    const mysqlOption = i.customId === 'mysql_yes' ? 'yes' : 'no';
                    await i.update({ content: `${lang.mysqlSelected} ${mysqlOption}`, components: [] });

                    const command = mysqlOption === "yes"
                        ? "bash <(curl -s https://raw.githubusercontent.com/Twe3x/fivem-installer/main/setup.sh) --non-interactive --kill-port -c --delete-dir"
                        : "bash <(curl -s https://raw.githubusercontent.com/Twe3x/fivem-installer/main/setup.sh) --no-mysql";
                    try {
                        ssh.exec(command, (err, stream) => {
                            if (err) {
                                setWaitingStatus();
                                return sendErrorEmbed(interaction, customId, lang, err, errorChannelId);
                            }

                            stream.on('data', async data => {
                                const newOutput = data.toString();
                                output += newOutput;

                                const chunks = chunkOutput(output);
                                if (chunks.length > 0) {
                                    try {
                                        await interaction.editReply({
                                            content: chunks[chunks.length - 1],
                                            components: []
                                        });

                                        if (chunks.length > 1) {
                                            for (let i = 0; i < chunks.length - 1; i++) {
                                                await interaction.followUp({
                                                    content: chunks[i],
                                                    ephemeral: true
                                                });
                                            }
                                        }
                                    } catch (error) {
                                        console.error('Error updating messages:', error);
                                    }
                                }
                            });


                            async function generateScreenshot(output) {
                                let browser = null;
                                try {
                                    browser = await puppeteer.launch({
                                        headless: "new",
                                        args: ['--no-sandbox', '--disable-setuid-sandbox'],
                                        userDataDir: path.join(os.tmpdir(), `puppeteer_dev_chrome_profile-${Date.now()}`)
                                    });

                                    const page = await browser.newPage();
                                    await page.setDefaultNavigationTimeout(30000);

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
                                        } catch (error) {
                                            console.error('Browser close error:', error);
                                        }
                                    }
                                }
                            }

                            stream.on('close', async () => {
                                ssh.end();
                                const tempDir = os.tmpdir();
                                const outputFilePath = path.join(tempDir, `output-${Date.now()}.txt`);

                                try {
                                    fs.writeFileSync(outputFilePath, output);
                                    const screenshotPath = await generateScreenshot(output);

                                    const files = [];
                                    if (fs.existsSync(outputFilePath)) {
                                        files.push({ attachment: outputFilePath, name: "output.txt" });
                                    }
                                    if (screenshotPath && fs.existsSync(screenshotPath)) {
                                        files.push({ attachment: screenshotPath, name: "output.png" });
                                    }

                                    const { url, pin, path: serverPath } = parseOutput(output);

                                    await interaction.followUp({
                                        content: `${lang.processFinished} (ID: **__${customId}__**)`,
                                        embeds: [successEmbed],
                                        files,
                                        ephemeral: true
                                    });

                                    setTimeout(() => {
                                        try {
                                            if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
                                            if (screenshotPath && fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
                                        } catch (error) {
                                            console.error('Cleanup error:', error);
                                        }
                                    }, 1000);

                                    const embed = new EmbedBuilder()
                                        .setColor('#00FF00')
                                        .setTitle(lang.installationSuccess)
                                        .setDescription(`Installation completed successfully (ID: **__${customId}__**).`)
                                        .addFields(
                                            { name: 'Output', value: `\`\`\`${output || "No output"}\`\`\`` }
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

                                    try {
                                        await interaction.user.send({
                                            content: `${lang.processFinished} (ID: **__${customId}__**)`,
                                            embeds: [embed],
                                            files: [
                                                { attachment: screenshotPath, name: "output.png" },
                                                { attachment: outputFilePath, name: "output.txt" }
                                            ]
                                        });
                                    } catch (dmError) {
                                        console.error("Failed to send DM:", dmError);
                                    }

                                    fs.unlinkSync(outputFilePath);
                                    fs.unlinkSync(screenshotPath);

                                    const publicEmbed = new EmbedBuilder()
                                        .setColor('#00FF00')
                                        .setTitle('Server Installation')
                                        .setDescription(`A new FiveM server has been successfully installed by <@${interaction.user.id}>!`)
                                        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                        .setTimestamp();

                                    const announcementChannel = client.channels.cache.get(announcementChannelId);
                                    if (announcementChannel) {
                                        announcementChannel.send({ embeds: [publicEmbed] });
                                    }

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

                                    const successChannel = client.channels.cache.get(successChannelId);
                                    if (successChannel) {
                                        successChannel.send({ embeds: [successEmbed] });
                                    }

                                    statistics.totalInstallations += 1;
                                    if (mysqlOption === "yes") {
                                        statistics.mysqlInstallations += 1;
                                    } else {
                                        statistics.nonMysqlInstallations += 1;
                                    }
                                    saveStatistics();

                                    setWaitingStatus();
                                } catch (error) {
                                    setWaitingStatus();
                                    return sendErrorEmbed(interaction, customId, lang, error, errorChannelId);
                                }
                            });
                        });
                        collector.on('end', async collected => {
                            if (!collected.size) {
                                await interaction.editReply({ content: `${lang.noResponse} (ID: **__${customId}__**)`, components: [] });
                                setWaitingStatus();
                            }
                        });

                    } catch (error) {
                        setWaitingStatus();
                        return sendErrorEmbed(interaction, customId, lang, error, errorChannelId);
                    }
                }).on('error', async (err) => {
                    // console.error("SSH Error:", err);
                    const suggestion = err.level === 'client-authentication' ? 'Check your username and password' : 'Check your IP address and port';

                    const errorEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('Connection Error')
                        .setDescription(
                            `It seems the provided connection details are incorrect:\n\n` +
                            `**Error:** ${truncateString(err.message || 'Unknown error')}\n\n` +
                            `**Suggestion:** ${truncateString(suggestion)}\n\n` +
                            `${truncateString(lang.checkInputs)}\n\n` +
                            `${truncateString(lang.tryAgain)} <#${helpChannelId}>\n` +
                            `${truncateString(lang.sendId)}`
                        )
                        .addFields([
                            { name: 'IP Address', value: String(`||${ip}||`).slice(0, 1000), inline: true },
                            { name: 'Port', value: String(`||${port}||`).slice(0, 1000), inline: true },
                            { name: 'Username', value: String(`||${user}||`).slice(0, 1000), inline: true },
                            { name: 'Error', value: truncateString(err.message || 'Unknown error') }
                        ])
                        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();

                    const adminerrorEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('Connection Error')
                        .setDescription(
                            `The user <@${interaction.user.id}>, had an error\n\n` +
                            `**Error:** ${err.message || 'Unknown error'}\n\n`
                        )
                        .setFields(
                            { name: 'IP Address', value: `||${ip}||`, inline: true },
                            { name: 'Port', value: `||${port}||`, inline: true },
                            { name: 'Username', value: `||${user}||`, inline: true },
                            { name: 'ID', value: `**__${customId}__**`, inline: true }
                        )
                        .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();

                    const errorChannel = client.channels.cache.get(errorChannelId);
                    if (errorChannel) {
                        errorChannel.send({ embeds: [adminerrorEmbed] });
                    }

                    if (!interaction.replied) {
                        await interaction.editReply({
                            content: `An error occurred: (ID: **__${customId}__**)`,
                            embeds: [errorEmbed],
                            ephemeral: true
                        });
                    } else {
                        await interaction.followUp({
                            content: `An error occurred: (ID: **__${customId}__**)`,
                            embeds: [errorEmbed],
                            ephemeral: true
                        });
                    }

                    statistics.errors[err.message] = (statistics.errors[err.message] || 0) + 1;
                    saveStatistics();
                    setWaitingStatus();
                }).connect({ host: ip, port: parseInt(port), username: user, password: password });
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

                    await interaction.reply({ embeds: [statsEmbed], ephemeral: true });
                } catch (error) {
                    console.error('Error handling stats command:', error);
                    await interaction.reply({ content: 'An error occurred while fetching statistics.', ephemeral: true });
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
                        ephemeral: true
                    });
                } catch (error) {
                    console.error('Error handling help command:', error);
                    await interaction.reply({ content: 'An error occurred while fetching help information.', ephemeral: true });
                }
            }
        }
    }
});
client.login(token);