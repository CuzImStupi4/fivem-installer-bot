require("dotenv").config();
const { Routes } = require('discord-api-types/v10');
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Client: SSHClient } = require('ssh2');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');

const token = process.env.DISCORD_BOT_TOKEN;
const clientid = process.env.DISCORD_CLIENT_ID;

if (!token || !clientid) {
    throw new Error("Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID in .env file");
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    ws: { properties: { browser: "Discord iOS" } }
});

const commands = [
    new SlashCommandBuilder()
        .setName("install")
        .setDescription("Installs a FiveM server")
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
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() || interaction.commandName !== "install") return;

    const ip = interaction.options.getString("ip");
    const port = interaction.options.getString("port");
    const user = interaction.options.getString("user");
    const password = interaction.options.getString("password");

    const ssh = new SSHClient();
    let output = '';

    ssh.on('ready', async () => {
        const mysqlRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('mysql_yes')
                    .setLabel('Install MySQL')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('mysql_no')
                    .setLabel('Skip MySQL')
                    .setStyle(ButtonStyle.Danger)
            );
        try {
            await interaction.reply({ content: "Do you want to install MySQL?", ephemeral: true, components: [mysqlRow] });

            const filter = i => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });
            collector.on('collect', async i => {
                const mysqlOption = i.customId === 'mysql_yes' ? 'yes' : 'no';
                await i.update({ content: `MySQL installation selected: ${mysqlOption}`, components: [] });

                const command = mysqlOption === "yes" ? "echo Installing FiveM with MySQL..." : "echo Installing FiveM without MySQL...";
                try {
                    ssh.exec(command, (err, stream) => {
                        if (err) {
                            return interaction.followUp({ content: `SSH Error: ${err.message}`, ephemeral: true });
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
                                    <body style="background: black; color: white; font-family: monospace; padding: 20px;">
                                        <h1>Server Installation Output</h1>
                                        <pre>${output || "No output"}</pre>
                                        <footer style="margin-top: 20px; text-align: center; font-size: 14px;">
                                            Made by Lucas & CuzImStupi4 with ❤️
                                        </footer>
                                    </body>
                                </html>
                            `);

                            await page.screenshot({ path: screenshotPath });
                            await browser.close();
                            const embed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setTitle('FiveM Server Installation')
                                .setDescription(`Installation completed successfully.`)
                                .addFields(
                                    { name: 'Output', value: `\`\`\`${output || "No output"}\`\`\`` }
                                )
                                .setFooter({ text: 'Made by Lucentix & CuzImStupi4 with ❤️', iconURL: client.user.displayAvatarURL() })
                                .setTimestamp();

                            await interaction.followUp({
                                content: 'Server installation process finished!',
                                embeds: [embed],
                                files: [
                                    { attachment: screenshotPath, name: "output.png" },
                                    { attachment: outputFilePath, name: "output.txt" }
                                ],
                                ephemeral: true
                            });

                            fs.unlinkSync(outputFilePath);
                            fs.unlinkSync(screenshotPath);
                        });
                    });
                } catch (err) {
                    console.error("Error executing command:", err);
                    await interaction.followUp({ content: `Execution failed: ${err.message}`, ephemeral: true });
                }
            });
            collector.on('end', async collected => {
                if (!collected.size) {
                    await interaction.editReply({ content: "No response received. MySQL installation skipped.", components: [] });
                }
            });

        } catch (error) {
            console.error("Error during interaction:", error);
            if (!interaction.replied) {
                await interaction.reply({ content: "An error occurred during the process.", ephemeral: true });
            }
        }
    }).on('error', async (err) => {
        console.error("SSH Error:", err);

        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Connection Error')
            .setDescription(
                `It seems the provided connection details are incorrect:\n\n` +
                `**Error:** ${err.message || 'Unknown error'}\n\n` +
                `Please check your inputs and execute the command again.`
            )
            .setFields(
                { name: 'IP Address', value: ip, inline: true },
                { name: 'Port', value: port, inline: true },
                { name: 'Username', value: user, inline: true },
                { name: 'Password', value: `||${password}||`, inline: true }
            )
            .setTimestamp();
        if (!interaction.replied) {
            await interaction.reply({
                content: 'An error occurred:',
                embeds: [errorEmbed],
                ephemeral: true
            });
        }
    }).connect({ host: ip, port: parseInt(port), username: user, password: password });
});

client.login(token);
//