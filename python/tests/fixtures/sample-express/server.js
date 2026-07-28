const express = require("express");
const usersRouter = require("./routes/users");

const app = express();
app.use("/users", usersRouter);

app.get("/health", (req, res) => {
  res.send("ok");
});

app.listen(3000);
