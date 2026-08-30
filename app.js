// imports
const express = require("express")
const app = express()
const dotenv = require("dotenv").config()
const cookieParser = require("cookie-parser");
const morgan = require('morgan')
const cors = require('cors')


// Routes Import
const authRoutes = require('./routes/auth.routes')
const accountRoutes = require('./routes/account.routes')
const profileRoutes = require('./routes/profile.routes')
const adminRoutes = require('./routes/admin.routes')
const skillRoutes = require('./routes/skill.routes')
const jobRoutes = require("./routes/job.routes");
const categoryRoutes = require('./routes/category.routes')
const walletRoutes = require('./routes/wallet.routes')
const proposalRoutes = require('./routes/proposal.routes')
const contractRoutes = require("./routes/contract.routes")
const reviewRoutes = require("./routes/review.routes")
const uploadRoutes = require("./routes/upload.routes")


// Middleware
app.use(
    cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
    })
);

app.use(express.json())
// Authentication links carry secrets. Preserve useful request logs without recording them.
morgan.token('url', (req) => {
    try {
        const url = new URL(req.originalUrl || req.url, 'http://localhost');
        const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
        if (pathname.endsWith('/auth/verify-email') || pathname.endsWith('/auth/reset-password')) {
            return `${url.pathname}${url.search ? '?[REDACTED]' : ''}`;
        }
        if (url.searchParams.has('token')) {
            url.searchParams.set('token', '[REDACTED]');
            return `${url.pathname}${url.search}`;
        }
        return req.originalUrl || req.url;
    } catch (_) {
        return req.path;
    }
});
app.use(morgan('dev'))
app.use(cookieParser())



// Routes
app.use('/auth', authRoutes)
app.use("/users", accountRoutes)
app.use("/profile", profileRoutes)
app.use('/admin', adminRoutes)
app.use('/skills', skillRoutes)
app.use('/jobs', jobRoutes)
app.use('/categories', categoryRoutes)
app.use('/wallet', walletRoutes)
app.use("/proposals", proposalRoutes);
app.use("/contracts", contractRoutes);
app.use("/uploads", uploadRoutes);
app.use("/", reviewRoutes);





module.exports = app
