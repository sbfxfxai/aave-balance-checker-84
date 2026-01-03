# Contributing to TiltVault

Thank you for your interest in contributing to TiltVault! This document provides guidelines and instructions for contributing.

## Getting Started

1. **Fork the repository**
2. **Clone your fork**: `git clone https://github.com/YOUR_USERNAME/aave-balance-checker-84.git`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes**
5. **Test your changes**
6. **Commit your changes**: Follow our commit message conventions
7. **Push to your fork**: `git push origin feature/your-feature-name`
8. **Create a Pull Request**

## Development Setup

### Prerequisites

- Node.js 18.x or 20.x
- npm or yarn
- Git

### Installation

```bash
# Install frontend dependencies
cd frontend
npm install

# Install API dependencies
cd ../api
npm install
```

### Running Locally

```bash
# Frontend development server
cd frontend
npm run dev

# API (runs on Vercel serverless functions)
# Deploy to Vercel or use Vercel CLI
```

## Code Style

- **TypeScript**: Use TypeScript for type safety
- **ESLint**: Follow the project's ESLint configuration
- **Prettier**: Code will be auto-formatted
- **Naming**: Use descriptive names, follow camelCase for variables/functions, PascalCase for components

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(deposit): add hub wallet balance check
fix(webhook): prevent duplicate AVAX transfers
docs(readme): update installation instructions
```

## Testing

### Frontend Tests

```bash
cd frontend
npm test
```

### API Tests

```bash
cd api
npm test
npm run test:security
```

### Writing Tests

- Write tests for new features
- Maintain or improve test coverage
- Include edge cases and error scenarios
- Security tests are especially important

## Pull Request Process

1. **Update Documentation**: Update relevant documentation if needed
2. **Add Tests**: Ensure all tests pass
3. **Update CHANGELOG**: Add entry if applicable
4. **Create PR**: Use the PR template
5. **Wait for Review**: Address any feedback

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests pass
- [ ] No new warnings

## Security

- **Never commit secrets** (API keys, private keys, etc.)
- **Report vulnerabilities** via security@tiltvault.com (not public issues)
- **Review security implications** of your changes
- **Follow security best practices**

## Areas for Contribution

### High Priority

- Security improvements
- Bug fixes
- Performance optimizations
- Test coverage improvements

### Medium Priority

- New features (discuss in issues first)
- Documentation improvements
- UI/UX enhancements
- Accessibility improvements

### Low Priority

- Code refactoring
- Dependency updates
- Code style improvements

## Questions?

- **Issues**: Open an issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Email**: support@tiltvault.com

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

Thank you for contributing to TiltVault! 🚀

