require("dotenv").config();
const { Routes } = require('discord-api-types/v10');
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Client: SSHClient } = require('ssh2');
const { REST } = require('@discordjs/rest');
const fs = require('fs');
const puppeteer = require('puppeteer');

const token = process.env.DISCORD_BOT_TOKEN;
const clientid = process.env.DISCORD_CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
        console.error(error);
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
    let mysqlOption;

    const mysqlRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('mysql_yes')
                .setLabel('Yes')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('mysql_no')
                .setLabel('No')
                .setStyle(ButtonStyle.Danger)
        );

    try {
        await interaction.reply({ content: "Do you want to install MySQL?", ephemeral: true, components: [mysqlRow] });

        const filter = i => i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter });

        collector.on('collect', async i => {
            mysqlOption = i.customId === 'mysql_yes' ? 'yes' : 'no';
            await i.update({ content: `MySQL option selected: ${mysqlOption}`, components: [] });

            const ssh = new SSHClient();
            let output = '';

            ssh.on('ready', () => {
                // TODO: Add the actual command to install the FiveM server
                const mysqlCommand = mysqlOption === "yes" ? "echo Hello with mysql!" : "echo Hello!";
                ssh.exec(mysqlCommand, (err, stream) => {
                    if (err) {
                        return interaction.followUp({ content: `Error: ${err.message}`, ephemeral: true });
                    }

                    stream.on('data', data => output += data.toString());
                    stream.on('close', async () => {
                        ssh.end();
                        fs.writeFileSync("output.txt", output);

                        const browser = await puppeteer.launch();
                        const page = await browser.newPage();

                        await page.setContent(`
                            <html>
                                <body style="background: black; color: white; font-family: monospace; padding: 20px;">
                                    <h1>Output of the Command</h1>
                                    <pre>${output || "No output"}</pre>
                                </body>
                            </html>
                        `);

                        // TODO: Send it as a DM and don't send it in the public chat, also send it with reply as "only you can see it"
                        const screenshotPath = "output.png";
                        await page.screenshot({ path: screenshotPath });
                        await browser.close();

                        const embed = new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('Server Installation Completed')
                            .setDescription(`Command executed successfully!`)
                            .addFields(
                                { name: 'Command Executed', value: `\`\`\`\n${mysqlCommand}\n\`\`\`` },
                                { name: 'Output', value: `\`\`\`\n${output || "No output"}\n\`\`\`` }
                            )
                            .setTimestamp();

                        await interaction.followUp({
                            content: 'Server installation completed!',
                            embeds: [embed],
                            files: [
                                { attachment: screenshotPath, name: "output.png" },
                                { attachment: "output.txt", name: "output.txt" }
                            ]
                        });

                        fs.unlinkSync("output.txt");
                        fs.unlinkSync(screenshotPath);
                    });
                });
            }).connect({ host: ip, port: port, username: user, password: password });
        });

        collector.on('end', async collected => {
            if (!collected.size) {
                await interaction.editReply({ content: "No MySQL option selected in time.", components: [] });
            }
        });
    } catch (error) {
        console.error(error);
        await interaction.followUp({ content: "There was an error executing the command", ephemeral: true });
    }
});

client.login(token);
