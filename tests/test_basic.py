def test_package_import():
    import sys
    sys.path.insert(0, "src")
    import camillamix
    assert hasattr(camillamix, "__version__")
