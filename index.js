require("dotenv").config();
const { Routes } = require('discord-api-types/v10');
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Client: SSHClient } = require('ssh2');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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

// Initialize statistics
let statistics = {
    totalInstallations: 0,
    mysqlInstallations: 0,
    nonMysqlInstallations: 0,
    errors: {}
};

// Load statistics from file if it exists
const statsFilePath = path.join(__dirname, 'statistics.json');
if (fs.existsSync(statsFilePath)) {
    statistics = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
}

// Save statistics to file
function saveStatistics() {
    fs.writeFileSync(statsFilePath, JSON.stringify(statistics, null, 2));
}

const languages = {
    en: {
        installPrompt: "Do you want to install MySQL?\n⚠︎   This will then Fully **delete** the old database **if one is installed**!   ⚠︎\n\n⚠︎   **__We are not Responsible if it deleted something!__**   ⚠︎",
        mysqlYes: "Install MySQL",
        mysqlNo: "Skip MySQL",
        mysqlSelected: "MySQL installation selected: ",
        invalidIp: "Invalid IP address format.",
        invalidPort: "Invalid port format. Port must be a number between 0 and 65535.",
        noPermission: "You do not have permission to use this command.",
        installationSuccess: "Installation completed successfully",
        installationError: "An error occurred during the installation process",
        connectionError: "Connection Error",
        checkInputs: "Please check your inputs!",
        tryAgain: "Try again or open a ticket!",
        sendId: "If you ask in the Help Channel, kindly send the ID **__${customId}__** too!",
        noResponse: "No response received. MySQL installation skipped.",
        processFinished: "Server installation process finished!",
        newServer: "A new FiveM server has been successfully installed by <@${interaction.user.id}>!",
        statsTitle: "Installation Statistics",
        totalInstallations: "Total Installations",
        mysqlInstallations: "MySQL Installations",
        nonMysqlInstallations: "Non-MySQL Installations",
        errors: "Errors",
        noErrors: "No errors recorded"
    },
    de: {
        installPrompt: "Möchten Sie MySQL installieren?\n⚠︎   Dies wird dann die alte Datenbank vollständig **löschen**, **falls eine installiert ist**!   ⚠︎\n\n⚠︎   **__Wir sind nicht verantwortlich, wenn etwas gelöscht wurde!__**   ⚠︎",
        mysqlYes: "MySQL installieren",
        mysqlNo: "MySQL überspringen",
        mysqlSelected: "MySQL-Installation ausgewählt: ",
        invalidIp: "Ungültiges IP-Adressformat.",
        invalidPort: "Ungültiges Portformat. Der Port muss eine Zahl zwischen 0 und 65535 sein.",
        noPermission: "Sie haben keine Berechtigung, diesen Befehl zu verwenden.",
        installationSuccess: "Installation erfolgreich abgeschlossen",
        installationError: "Während des Installationsprozesses ist ein Fehler aufgetreten",
        connectionError: "Verbindungsfehler",
        checkInputs: "Bitte überprüfen Sie Ihre Eingaben!",
        tryAgain: "Versuchen Sie es erneut oder öffnen Sie ein Ticket!",
        sendId: "Wenn Sie im Hilfekanal fragen, senden Sie bitte auch die ID **__${customId}__**!",
        noResponse: "Keine Antwort erhalten. MySQL-Installation übersprungen.",
        processFinished: "Server-Installationsprozess abgeschlossen!",
        newServer: "Ein neuer FiveM-Server wurde erfolgreich von <@${interaction.user.id}> installiert!",
        statsTitle: "Installationsstatistiken",
        totalInstallations: "Gesamtinstallationen",
        mysqlInstallations: "MySQL-Installationen",
        nonMysqlInstallations: "Nicht-MySQL-Installationen",
        errors: "Fehler",
        noErrors: "Keine Fehler aufgezeichnet"
    }
};

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

                    const command = mysqlOption === "yes" ? "echo Installing FiveM with MySQL..." : "echo Installing FiveM without MySQL...";
                    try {
                        ssh.exec(command, (err, stream) => {
                            if (err) {
                                const errorEmbed = new EmbedBuilder()
                                    .setColor('#FF0000')
                                    .setTitle('Installation Error')
                                    .setDescription(`An error occurred during the installation process (ID: **__${customId}__**).`)
                                    .addFields(
                                        { name: 'IP Address', value: `||${ip}||`, inline: true },
                                        { name: 'Port', value: `||${port}||`, inline: true },
                                        { name: 'Username', value: `||${user}||`, inline: true },
                                        { name: 'Error', value: err.message }
                                    )
                                    .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                    .setTimestamp();

                                const errorChannel = client.channels.cache.get(errorChannelId);
                                if (errorChannel) {
                                    errorChannel.send({ embeds: [errorEmbed] });
                                }

                                // Track errors
                                statistics.errors[err.message] = (statistics.errors[err.message] || 0) + 1;
                                saveStatistics();

                                return interaction.followUp({ content: `SSH Error: ${err.message} (ID: **__${customId}__**)`, flags: 64 });
                            }

                            stream.on('data', data => output += data.toString());
                            stream.on('close', async () => {
                                ssh.end();
                                const tempDir = os.tmpdir();
                                const outputFilePath = path.join(tempDir, "output.txt");
                                const screenshotPath = path.join(tempDir, "output.png");

                                fs.writeFileSync(outputFilePath, output);

                                const browser = await puppeteer.launch({ headless: true });
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

                                await page.screenshot({ path: screenshotPath });
                                await browser.close();
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

                                // Send DM to user
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
                                    .setDescription(`A new FiveM server has been successfully installed by <@${interaction.user.id}>!`)
                                    .addFields(
                                        { name: 'ID:', value: `**__${customId}__**`, inline: true },
                                        { name: 'IP Address:', value: `||${ip}||`, inline: true },
                                        { name: 'Port:', value: `||${port}||`, inline: true },
                                        { name: 'Username:', value: `||${user}||`, inline: true },
                                        { name: 'MySQL:', value: mysqlOption === "yes" ? "Yes" : "No", inline: true },
                                    )
                                    .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                    .setTimestamp();

                                const successChannel = client.channels.cache.get(successChannelId);
                                if (successChannel) {
                                    successChannel.send({ embeds: [successEmbed] });
                                }

                                // Update statistics
                                statistics.totalInstallations += 1;
                                if (mysqlOption === "yes") {
                                    statistics.mysqlInstallations += 1;
                                } else {
                                    statistics.nonMysqlInstallations += 1;
                                }
                                saveStatistics();
                            });
                        });
                    } catch (err) {
                        console.error("Error executing command:", err);
                        const errorEmbed = new EmbedBuilder()
                            .setColor('#FF0000')
                            .setTitle(lang.installationError)
                            .setDescription(`An error occurred during the installation process (ID: **__${customId}__**).`)
                            .addFields(
                                { name: 'IP Address', value: `||${ip}||`, inline: true },
                                { name: 'Port', value: `||${port}||`, inline: true },
                                { name: 'Username', value: `||${user}||`, inline: true },
                                { name: 'Error', value: err.message }
                            )
                            .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                            .setTimestamp();

                        const errorChannel = client.channels.cache.get(errorChannelId);
                        if (errorChannel) {
                            errorChannel.send({ embeds: [errorEmbed] });
                        }

                        // Track errors
                        statistics.errors[err.message] = (statistics.errors[err.message] || 0) + 1;
                        saveStatistics();

                        await interaction.followUp({ content: `Execution failed: ${err.message} (ID: **__${customId}__**)`, flags: 64 });
                    }
                });
                collector.on('end', async collected => {
                    if (!collected.size) {
                        await interaction.editReply({ content: `${lang.noResponse} (ID: **__${customId}__**)`, components: [] });
                    }
                });

            } catch (error) {
                console.error("Error during interaction:", error);
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle(lang.installationError)
                    .setDescription(`An error occurred during the interaction process (ID: **__${customId}__**).`)
                    .addFields(
                        { name: 'IP Address', value: `||${ip}||`, inline: true },
                        { name: 'Port', value: `||${port}||`, inline: true },
                        { name: 'Username', value: `||${user}||`, inline: true },
                        { name: 'Error', value: error.message }
                    )
                    .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                const errorChannel = client.channels.cache.get(errorChannelId);
                if (errorChannel) {
                    errorChannel.send({ embeds: [errorEmbed] });
                }

                if (!interaction.replied) {
                    await interaction.editReply({ content: `An error occurred during the process. (ID: **__${customId}__**)`, flags: 64 });
                }

                // Track errors
                statistics.errors[error.message] = (statistics.errors[error.message] || 0) + 1;
                saveStatistics();
            }
        }).on('error', async (err) => {
            console.error("SSH Error:", err);
            const suggestion = err.level === 'client-authentication' ? 'Check your username and password' : 'Check your IP address and port';

            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Connection Error')
                .setDescription(
                    `It seems the provided connection details are incorrect:\n\n` +
                    `**Error:** ${err.message || 'Unknown error'}\n\n` +
                    `**Suggestion:** ${suggestion}\n\n` +
                    `${lang.checkInputs}\n\n` +
                    `${lang.tryAgain} <#${helpChannelId}>\n` +
                    `${lang.sendId}`
                )
                .setFields(
                    { name: 'IP Address', value: `||${ip}||`, inline: true },
                    { name: 'Port', value: `||${port}||`, inline: true },
                    { name: 'Username', value: `||${user}||`, inline: true },
                    { name: 'Password', value: `||**__${password}__**||`, inline: true }
                )
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
                    flags: 64
                });
            } else {
                await interaction.followUp({
                    content: `An error occurred: (ID: **__${customId}__**)`,
                    embeds: [errorEmbed],
                    flags: 64
                });
            }

            // Track errors
            statistics.errors[err.message] = (statistics.errors[err.message] || 0) + 1;
            saveStatistics();
        }).connect({ host: ip, port: parseInt(port), username: user, password: password });
    } else if (interaction.commandName === "stats") {
        const errorStats = Object.entries(statistics.errors).map(([error, count]) => `${error}: ${count}`).join('\n') || 'No errors recorded';

        const statsEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Installation Statistics')
            .addFields(
                { name: 'Total Installations', value: statistics.totalInstallations.toString(), inline: true },
                { name: 'MySQL Installations', value: statistics.mysqlInstallations.toString(), inline: true },
                { name: 'Non-MySQL Installations', value: statistics.nonMysqlInstallations.toString(), inline: true },
                { name: 'Errors', value: errorStats }
            )
            .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [statsEmbed], flags: 64 });
    }
});

client.login(token);