# Contributing to SMS Telegram Forwarder

Thank you for your interest in contributing to SMS Telegram Forwarder! We welcome contributions from the community.

## How to Contribute

### 1. Fork the Repository
- Click the "Fork" button on GitHub
- Clone your fork: `git clone https://github.com/yourusername/sms-telegram-forwarder.git`

### 2. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 3. Make Your Changes
- Follow the existing code style
- Add comments for complex logic
- Test your changes thoroughly

### 4. Commit Your Changes
```bash
git add .
git commit -m "Add: Brief description of your changes"
```

### 5. Push and Create Pull Request
```bash
git push origin feature/your-feature-name
```
Then create a Pull Request on GitHub.

## Development Setup

### Prerequisites
- Node.js 16+
- Android Studio (for Android app development)
- Telegram Bot Token

### Installation
```bash
# Install server dependencies
npm install

# For development
npm run dev

# For production
npm start
```

## Code Style Guidelines

### JavaScript/Node.js
- Use ES6+ features
- Use async/await for asynchronous operations
- Add JSDoc comments for functions
- Use meaningful variable names

### Android/Java
- Follow Android coding standards
- Use proper resource naming conventions
- Handle permissions correctly
- Add proper error handling

## Testing

### Server Testing
```bash
# Add your test commands here
npm test
```

### Android Testing
- Use Android Studio's built-in testing tools
- Test on multiple devices/emulators
- Test edge cases and error scenarios

## Reporting Issues

When reporting issues, please include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Screenshots/logs if applicable
- Your environment (OS, Node.js version, Android version)

## Security

- Never commit sensitive information (API keys, tokens)
- Use environment variables for configuration
- Report security vulnerabilities privately

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
