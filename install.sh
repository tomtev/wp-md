#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
REPO="tomtev/wp-md"
INSTALL_DIR="${WP_MD_INSTALL_DIR:-$HOME/.wp-md}"
BIN_DIR="$HOME/.local/bin"

print_banner() {
    echo ""
    echo -e "${CYAN}  ╦ ╦╔═╗   ╔╦╗╔╦╗${NC}"
    echo -e "${CYAN}  ║║║╠═╝───║║║ ║║${NC}"
    echo -e "${CYAN}  ╚╩╝╩     ╩ ╩═╩╝${NC}"
    echo ""
    echo "  Create & edit remote WordPress content as markdown files locally."
    echo ""
}

info() {
    echo -e "${BLUE}INFO${NC} $1"
}

success() {
    echo -e "${GREEN}SUCCESS${NC} $1"
}

warn() {
    echo -e "${YELLOW}WARN${NC} $1"
}

error() {
    echo -e "${RED}ERROR${NC} $1"
    exit 1
}

detect_os() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux*)     OS_TYPE="linux";;
        Darwin*)    OS_TYPE="darwin";;
        MINGW*|MSYS*|CYGWIN*) OS_TYPE="windows";;
        *)          error "Unsupported operating system: $OS";;
    esac

    case "$ARCH" in
        x86_64|amd64)   ARCH_TYPE="x64";;
        arm64|aarch64)  ARCH_TYPE="arm64";;
        *)              error "Unsupported architecture: $ARCH";;
    esac

    info "Detected: $OS_TYPE ($ARCH_TYPE)"
}

check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d 'v' -f 2)
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d '.' -f 1)

        if [ "$NODE_MAJOR" -ge 18 ]; then
            info "Node.js v$NODE_VERSION detected"
            return 0
        else
            warn "Node.js v$NODE_VERSION found, but v18+ is required"
            return 1
        fi
    fi
    return 1
}

check_npm() {
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        info "npm v$NPM_VERSION detected"
        return 0
    fi
    return 1
}

install_via_npm() {
    info "Installing via npm..."

    if npm install -g wp-md 2>/dev/null; then
        success "Installed via npm"
        return 0
    fi

    # Try with sudo if permission denied
    warn "Retrying with sudo..."
    if sudo npm install -g wp-md; then
        success "Installed via npm (with sudo)"
        return 0
    fi

    return 1
}

install_via_github() {
    info "Installing from GitHub..."

    # Create directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BIN_DIR"

    # Get latest release
    LATEST_URL="https://api.github.com/repos/$REPO/releases/latest"

    if command -v curl &> /dev/null; then
        RELEASE_INFO=$(curl -sL "$LATEST_URL")
    elif command -v wget &> /dev/null; then
        RELEASE_INFO=$(wget -qO- "$LATEST_URL")
    else
        error "curl or wget is required"
    fi

    # Extract version
    VERSION=$(echo "$RELEASE_INFO" | grep '"tag_name"' | cut -d '"' -f 4)

    if [ -z "$VERSION" ]; then
        VERSION="main"
        TARBALL_URL="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
    else
        TARBALL_URL="https://github.com/$REPO/archive/refs/tags/$VERSION.tar.gz"
    fi

    # Download and extract
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"

    info "Downloading..."
    if command -v curl &> /dev/null; then
        curl -sL "$TARBALL_URL" | tar xz
    else
        wget -qO- "$TARBALL_URL" | tar xz
    fi

    # Find extracted directory
    EXTRACTED_DIR=$(ls -d */ | head -n 1)

    # Move to install directory
    rm -rf "$INSTALL_DIR"
    mv "$EXTRACTED_DIR" "$INSTALL_DIR"

    # Install dependencies
    cd "$INSTALL_DIR"

    info "Installing dependencies..."
    npm install --omit=dev --silent

    # Create bin directory and symlink
    mkdir -p "$BIN_DIR"
    ln -sf "$INSTALL_DIR/bin/cli.js" "$BIN_DIR/wp-md"
    chmod +x "$INSTALL_DIR/bin/cli.js"

    # Cleanup
    rm -rf "$TEMP_DIR"

    success "Installed to $INSTALL_DIR"
}

setup_path() {
    SHELL_NAME=$(basename "$SHELL")

    case "$SHELL_NAME" in
        bash)
            PROFILE="$HOME/.bashrc"
            [ -f "$HOME/.bash_profile" ] && PROFILE="$HOME/.bash_profile"
            ;;
        zsh)
            PROFILE="$HOME/.zshrc"
            ;;
        fish)
            PROFILE="$HOME/.config/fish/config.fish"
            ;;
        *)
            PROFILE="$HOME/.profile"
            ;;
    esac

    # Check if BIN_DIR is already in PATH
    if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
        return 0
    fi

    # Add to profile
    if [ -n "$PROFILE" ] && [ -f "$PROFILE" ]; then
        if ! grep -q "wp-md" "$PROFILE" 2>/dev/null; then
            echo "" >> "$PROFILE"
            echo "# wp-md" >> "$PROFILE"

            if [ "$SHELL_NAME" = "fish" ]; then
                echo "set -gx PATH \$PATH $BIN_DIR" >> "$PROFILE"
            else
                echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$PROFILE"
            fi

            info "Added $BIN_DIR to PATH in $PROFILE"
            warn "Run 'source $PROFILE' or restart your terminal"
        fi
    fi
}

verify_installation() {
    # Add BIN_DIR to current PATH for verification
    export PATH="$PATH:$BIN_DIR"

    if command -v wp-md &> /dev/null; then
        success "wp-md is installed!"
        echo ""
        wp-md --version
        echo ""
        echo -e "${GREEN}Get started:${NC}"
        echo "  cd your-project"
        echo "  wp-md init"
        echo "  wp-md pull"
        return 0
    else
        error "Installation verification failed"
    fi
}

main() {
    print_banner
    detect_os

    if ! check_node || ! check_npm; then
        echo ""
        error "Node.js 18+ is required. Install it first:
  - macOS: brew install node
  - Ubuntu: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
  - Or visit: https://nodejs.org/"
    fi

    echo ""
    install_via_github
    setup_path

    echo ""
    success "wp-md installed!"
    echo ""
    echo -e "${GREEN}Get started:${NC}"
    echo ""
    echo "  cd your-project"
    echo "  wp-md init"
    echo "  wp-md pull"
    echo ""
}

main "$@"
