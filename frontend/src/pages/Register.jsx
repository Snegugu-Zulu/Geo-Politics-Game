import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Globe, User, Mail, Lock } from "lucide-react";
import api from "../services/api";

function Register() {
    const navigate = useNavigate();

    const [form, setForm] = useState({
        username: "",
        email: "",
        password: "",
        confirmPassword: ""
    });

    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);

    const handleChange = event => {
        setForm({
            ...form,
            [event.target.name]: event.target.value
        });
    };

    const handleSubmit = async event => {
        event.preventDefault();

        setMessage("");

        if (form.password !== form.confirmPassword) {
            setMessage("Passwords do not match.");
            return;
        }

        if (form.password.length < 8) {
            setMessage("Password must contain at least 8 characters.");
            return;
        }

        setBusy(true);

        try {
            const { data } = await api.post(
                "/auth/register",
                {
                    username: form.username,
                    email: form.email,
                    password: form.password
                }
            );

            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));

            navigate("/new-game");

        } catch (error) {
            setMessage(
                error.response?.data?.message ||
                "Unable to create your account."
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-background"></div>

            <div className="auth-card">
                <div className="auth-brand">
                    <Globe size={35} />
                    <h1>GEO<span>POLITICS</span></h1>
                </div>

                <p className="eyebrow">JOIN THE CAMPAIGN</p>

                <h2>Create account</h2>

                <p className="auth-description">
                    Establish your identity before entering the battlefield.
                </p>

                <form onSubmit={handleSubmit}>
                    <label>Username</label>

                    <div className="input-wrapper">
                        <User size={17} />

                        <input
                            name="username"
                            placeholder="Choose a username"
                            value={form.username}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <label>Email address</label>

                    <div className="input-wrapper">
                        <Mail size={17} />

                        <input
                            type="email"
                            name="email"
                            placeholder="Enter your email"
                            value={form.email}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <label>Password</label>

                    <div className="input-wrapper">
                        <Lock size={17} />

                        <input
                            type="password"
                            name="password"
                            placeholder="Create a password"
                            value={form.password}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <label>Confirm password</label>

                    <div className="input-wrapper">
                        <Lock size={17} />

                        <input
                            type="password"
                            name="confirmPassword"
                            placeholder="Confirm your password"
                            value={form.confirmPassword}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    {message && (
                        <div className="form-message error">
                            {message}
                        </div>
                    )}

                    <button
                        className="primary-btn"
                        type="submit"
                        disabled={busy}
                    >
                        {busy ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
                    </button>
                </form>

                <p className="auth-footer">
                    Already registered?
                    <Link to="/login"> Sign in</Link>
                </p>
            </div>
        </div>
    );
}

export default Register;