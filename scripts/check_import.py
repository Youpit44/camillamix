import sys
sys.path.insert(0, 'src')
try:
    import camillamix
    print('OK', camillamix.__version__)
except Exception as e:
    print('ERROR', e)
    raise
