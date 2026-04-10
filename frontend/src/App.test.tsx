// Temporary test file to check if React is working
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Container, Typography, Box } from '@mui/material';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
});

export default function TestApp() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container>
        <Box sx={{ mt: 4 }}>
          <Typography variant="h3">React is Working!</Typography>
          <Typography variant="body1" sx={{ mt: 2 }}>
            If you see this, React and Material-UI are working correctly.
          </Typography>
        </Box>
      </Container>
    </ThemeProvider>
  );
}
