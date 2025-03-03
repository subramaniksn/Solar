const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const sql = require("mssql");
const path = require("path");
const dbConfig = require("./dbConfig.js"); // Ensure this contains your DB credentials

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Session Setup
app.use(
    session({
        secret: "your_secret_key",
        resave: false,
        saveUninitialized: true,
    })
);

// Cached Data (Updated Every 1 Minute)
let latestData = { 
    energyGenerated: 0, 
    currentPower: 0, 
    co2Saved: 0, 
    treesSaved: 0 
};

async function fetchLatestData() {
    try {
        let pool = await sql.connect(dbConfig);
        let powerResult = await pool.request().execute("sp_GetDashboardData");

        if (powerResult.recordset.length > 0) {
            latestData.energyGenerated = powerResult.recordset[0].energyGenerated;
            latestData.currentPower = powerResult.recordset[0].currentPower;
            latestData.co2Saved = powerResult.recordset[0].co2Saved;
            latestData.treesSaved = powerResult.recordset[0].treesSaved;
            console.log("🔄 Updated Data:", latestData);
        }
    } catch (err) {
        console.error("❌ Database Error:", err);
    }
}

// Fetch data every 60 seconds
setInterval(fetchLatestData, 60000);
fetchLatestData(); // Initial fetch when the server starts

// Route: Show Login Page (FIXED: Passing co2Saved and treesSaved)
app.get("/", (req, res) => {
    res.render("login", {
        message: "",
        energyGenerated: latestData.energyGenerated,
        currentPower: latestData.currentPower,
        co2Saved: latestData.co2Saved,
        treesSaved: latestData.treesSaved,
    });
});

// Route: Show Dashboard Page
app.get("/dashboard", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/"); // Redirect to login if not authenticated
    }

    res.render("dashboard", {
        username: req.session.user.username,
        energyGenerated: latestData.energyGenerated,
        currentPower: latestData.currentPower,
        co2Saved: latestData.co2Saved,
        treesSaved: latestData.treesSaved,
    });
});

// Route: Handle Login Authentication (FIXED: Passing co2Saved and treesSaved)
app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request()
            .input("username", sql.VarChar, username)
            .input("password", sql.VarChar, password)
            .query("SELECT * FROM Users WHERE username = @username AND password = @password");

        if (result.recordset.length > 0) {
            req.session.user = result.recordset[0];
            res.redirect("/dashboard");
        } else {
            res.render("login", { 
                message: "Invalid username or password!", 
                energyGenerated: latestData.energyGenerated, 
                currentPower: latestData.currentPower,
                co2Saved: latestData.co2Saved,
                treesSaved: latestData.treesSaved
            });
        }
    } catch (err) {
        console.error(err);
        res.render("login", { 
            message: "Database error!", 
            energyGenerated: latestData.energyGenerated, 
            currentPower: latestData.currentPower,
            co2Saved: latestData.co2Saved,
            treesSaved: latestData.treesSaved
        });
    }
});

// Route: API for Latest Dashboard Data (Using Stored Procedure)
app.get("/api/trend-data", async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);

        console.log("Fetching Power Trend Data...");
        let powerTrendResult = await pool.request().execute("sp_GetTrendData");
        console.log("Power Trend Data:", powerTrendResult.recordset);

        console.log("Fetching Energy Bar Data...");
        let energyBarResult = await pool.request().execute("sp_GetBarTrendData");
        console.log("Energy Bar Data:", energyBarResult.recordset);

        let timeLabels = [];
        let activePowerValues = [];
        let poaValues = [];
        let energyTimeLabels = [];
        let energyValues = [];

        powerTrendResult.recordset.forEach(row => {
            if (!row.Date_Time || !row.ACTIVE_POWER || !row.POA) {
                console.error("🚨 Missing data in Power Trend:", row);
                return;
            }

            let dateTime = new Date(row.Date_Time);
            if (isNaN(dateTime)) {
                console.error("🚨 Invalid date format:", row.Date_Time);
                return;
            }

            timeLabels.push(dateTime.toISOString().substring(11, 16));
            activePowerValues.push(row.ACTIVE_POWER);
            poaValues.push(row.POA);
        });

        energyBarResult.recordset.forEach(row => {
            if (!row.TIME || !row.energyGenerated) {
                console.error("🚨 Missing data in Energy Bar:", row);
                return;
            }
            energyTimeLabels.push(row.TIME);
            energyValues.push(row.energyGenerated);
        });

        res.json({ timeLabels, activePowerValues, poaValues, energyTimeLabels, energyValues });
    } catch (err) {
        console.error("❌ API Database Error:", err);
        res.status(500).json({ error: err.message });
    }
});
app.get('/inverter', (req, res) => {
    res.render('inverter');  // Ensure `inverter.ejs` exists in the views folder
});

// Route: Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log(err);
            return res.redirect('/dashboard');
        }
        res.redirect('/');
    });
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
