import {
    BrowserRouter,
    Routes,
    Route,
    Navigate
} from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import NewGame from "./pages/NewGame";
import Game from "./pages/Game";
import SharedGame from "./pages/SharedGame";

function ProtectedRoute({ children }) {
    const token = localStorage.getItem("token");

    return token
        ? children
        : <Navigate to="/login" replace />;
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route
                    path="/"
                    element={<Navigate to="/login" replace />}
                />

                <Route
                    path="/login"
                    element={<Login />}
                />

                <Route
                    path="/register"
                    element={<Register />}
                />

                <Route
                    path="/new-game"
                    element={
                        <ProtectedRoute>
                            <NewGame />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/game"
                    element={
                        <ProtectedRoute>
                            <Game />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/game/:gameId"
                    element={
                        <ProtectedRoute>
                            <Game />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/shared/:shareId"
                    element={<SharedGame />}
                />

                <Route
                    path="*"
                    element={<Navigate to="/login" replace />}
                />
            </Routes>
        </BrowserRouter>
    );
}

export default App;