require("dotenv").config();
const { createApp } = require("./reviewServer/app");

const PORT = parseInt(process.env.REVIEW_SERVER_PORT || "4000", 10);

const app = createApp();
app.listen(PORT, () => {
    console.log(`Review server running at http://localhost:${PORT}`);
    console.log(`(drafts come from output/**/upload.json — run "npm run transform" first if the dashboard is empty)`);
});
