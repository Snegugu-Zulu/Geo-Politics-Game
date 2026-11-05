import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Globe, Lock, Mail } from "lucide-react";
import api from "../services/api";

function Login() {
    const navigate = useNavigate();

    const [form, setForm] = useState({
        email: "",
        password: ""
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

        setBusy(true);
        setMessage("");

        try {
            const { data } = await api.post(
                "/auth/login",
                form
            );

            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));

            navigate("/new-game");

        } catch (error) {
            setMessage(
                error.response?.data?.message ||
                "Unable to log in. Please try again."
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

                <p className="eyebrow">GLOBAL STRATEGY SIMULATION</p>

                <h2>Welcome back</h2>

                <p className="auth-description">
                    Sign in to continue your campaign.
                </p>

                <form onSubmit={handleSubmit}>
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
                            placeholder="Enter your password"
                            value={form.password}
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
                        {busy ? "SIGNING IN..." : "SIGN IN"}
                    </button>
                </form>

                <p className="auth-footer">
                    Don't have an account?
                    <Link to="/register"> Create account</Link>
                </p>
            </div>
        </div>
    );
}

export default Login;