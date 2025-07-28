import nodemailer from "nodemailer";
import config from "../config/env.js";

const transporter = nodemailer.createTransport({
  host: config.get("email.host"),
  port: config.get("email.port"),
  secure: config.get("email.secure"),
  auth: {
    user: config.get("email.user"),
    pass: config.get("email.pass"),
  },
});


export const sendEmail = async (to, subject, html) => {
  console.log("Sending email...");
  console.log("Email config:", {
    host: config.get("email.host"),
    port: config.get("email.port"),
    secure: config.get("email.secure"),
    user: config.get("email.user"),
    pass: config.get("email.pass") ? "*****" : null,
    to,
    subject,
    html,
  });

  try {
    const info = await transporter.sendMail({
      from: `"Smare" <${config.get("email.sender")}>`,
      to,
      subject,
      html,
    });

    console.log("Email sent ✅:", info.messageId);
  } catch (err) {
    console.error("❌ Email sending failed:", err);
    throw new Error("Failed to send verification email");
  }
};
