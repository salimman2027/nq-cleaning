"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const app_1 = require("./app");
const db_1 = require("./db");
async function main() {
    void config_1.config.jwt.accessSecret; // fail fast when the secret is missing or too short
    await (0, db_1.getPool)();
    const server = (0, app_1.createApp)().listen(config_1.config.port, () => console.log(`NQ Cleaning API listening on :${config_1.config.port}`));
    const stop = async () => {
        server.close();
        await (0, db_1.closePool)();
        process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
main().catch((e) => {
    console.error('Startup failed:', e instanceof Error ? e.message : e);
    process.exit(1);
});
