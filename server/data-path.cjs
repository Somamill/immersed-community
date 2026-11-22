const path = require("node:path");
module.exports = path.join(process.env.IMMERSED_APP_HOME || path.join(__dirname, ".."), ".data");
